/**
 * 将 TaskRecord 压缩为可注入 LLM 的 system 片段（M2：任务上下文对齐）
 * 目的：确保模型在处理用户请求时，清楚当前任务的 ID、状态及最后几步操作。
 */
import type { TaskRecord, TaskTimelineEntry } from "./types";
import { getLastReviewFromRecord, getTaskPlanFromRecord } from "./collaborationService";
import type { TaskPlan } from "./collaborationTypes";
import { META_PENDING_APPROVAL_KEY } from "./collaborationTypes";

// 限制时间线长度，防止上下文过长（Token 浪费）及干扰模型注意力
const MAX_TIMELINE_LINES = 14;

/**
 * 格式化单条时间线记录
 * 将不同类型的事件（状态流转、备注、步骤完成）转换为易读的单行文本
 */
function timelineLine(e: TaskTimelineEntry): string {
    // 情况 A: 状态转换（例如：从 "进行中" 变为 "已完成"）
    if (e.kind === "transition") {
        const r = e.reason ? ` (${e.reason})` : "";
        return `[${e.at}] ${e.from} → ${e.to}${r}`;
    }
    // 情况 B: 用户或系统添加的随手笔记
    if (e.kind === "note") {
        return `[${e.at}] 备注: ${e.text}`;
    }

    // 情况 C: 任务步骤执行记录（最常见）
    const okMark = e.ok === false ? " 失败" : ""; // 显式标记失败步骤
    const lbl = e.label ? ` ${e.label}` : ""; // 步骤名称
    const sum = e.summary ? ` — ${e.summary}` : ""; // 执行摘要
    const ms = e.durationMs != null ? ` ${e.durationMs}ms` : ""; // 耗时
    const tid =
        e.meta && typeof e.meta.traceId === "string"
            ? ` trace=${(e.meta.traceId as string).slice(0, 8)}`
            : "" // 追踪 ID
    return `[${e.at}] 步骤 ${e.stepIndex}${lbl}${sum}${ms}${tid}${okMark}`;
}
/**
 * 【新增】格式化计划区块
 * 将复杂的 TaskPlan 对象转化为模型易读的列表格式
 */
function formatPlanBlock(plan: TaskPlan): string {
    const lines = plan.steps.map((s) => {
        // 提取关键属性：风险、状态、限制工具
        const r = s.risk ? ` risk=${s.risk}` : "";
        const st = s.status ? ` status=${s.status}` : "";
        const tools = s.allowedTools?.length ? ` tools=[${s.allowedTools.join(",")}]` : "";
        // 拼接成一行：  - [0] 步骤标题: 意图描述 risk=low status=done tools=[read_file]
        return `  - [${s.index}] ${s.title}: ${s.intent}${r}${st}${tools}`;
    });

    // 如果规划者留下了备注，也一并附上
    const note = plan.plannerNote ? `\nPlanner 说明: ${plan.plannerNote}` : "";

    return [
        "【结构化计划 v4_plan】",
        ...lines,
        note
    ].filter(Boolean).join("\n");
}
/**
 * 【核心函数】生成注入模型的任务上下文
 * 该函数返回的字符串会放在 System Prompt 中，强制模型遵循当前系统状态
 */
export function formatTaskContextForModel(task: TaskRecord): string {
    // 使用数组收集片段，最后 join('\n') 性能更优且代码整洁
    const parts: string[] = [
        "【当前关联任务（系统状态，请以此为准）】",
        `taskId: ${task.taskId}`,
        `标题: ${task.title}`,
        `状态: ${task.status}`,
    ];

    // 1.按需添加：只有存在这些字段时才注入，节省 Token
    if (task.templateId) parts.push(`模板: ${task.templateId}`);
    if (task.failureReason) parts.push(`最近失败原因: ${task.failureReason}`);

    // 2.检查点：标记任务当前停留在哪一步，是模型下一步动作的关键参考
    if (task.checkpoint) {
        const cp = task.checkpoint;
        parts.push(`检查点: stepIndex=${cp.stepIndex}${cp.label ? `, ${cp.label}` : ""}`);
    }

    // 3. 注入计划区块：告诉模型“未来的路怎么走”
    const plan = getTaskPlanFromRecord(task);
    if (plan) {
        parts.push("");
        parts.push(formatPlanBlock(plan));
    }
    // 4. 注入待审批区块：告诉模型“当前有待审批的动作”
    const pend = task.meta?.[META_PENDING_APPROVAL_KEY];
    if (pend && typeof pend === "object") {
        const p = pend as Record<string, unknown>;
        parts.push("");
        parts.push("【待审批动作 v4_pending_approval】");
        if (typeof p.toolName === "string") parts.push(`工具: ${p.toolName}`);
        if (typeof p.argsSummary === "string") parts.push(`参数摘要: ${p.argsSummary}`);
        if (typeof p.impactScope === "string") parts.push(`影响: ${p.impactScope}`);
        if (typeof p.rollbackHint === "string") parts.push(`回滚: ${p.rollbackHint}`);
    }
    // 5. 注入评审区块：告诉模型“之前哪里没做好，需要注意什么”
    const rev = getLastReviewFromRecord(task);
    if (rev) {
        parts.push("");
        parts.push("【最近一次评审 v4_last_review】");
        parts.push(`结论: ${rev.outcome}`); // pass 或 fail
        parts.push(`摘要: ${rev.summary}`); // 评审人的核心意见
        if (rev.findings.length) parts.push(`要点: ${rev.findings.join("；")}`);
        if (rev.resumeFromStepIndex != null) {
            parts.push(`建议返工自步骤: ${rev.resumeFromStepIndex}`);
        }
    }
    // 6. 注入操作流水（最近 14 条）
    parts.push("");
    parts.push("最近时间线（摘录，由旧到新）:");
    const tail = task.timeline.slice(-MAX_TIMELINE_LINES);
    if (tail.length === 0) parts.push("(暂无)");
    else for (const e of tail) parts.push(`- ${timelineLine(e)}`);

    // 7. 强约束性后缀
    parts.push("");
    parts.push(
        "说明: 请结合上述状态与用户消息继续推进；若与用户消息冲突，以本块任务状态、计划与检查点为准。"
    );

    return parts.join("\n");
}
