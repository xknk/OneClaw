/**
 * V4 M4：任务执行报告导出模块
 * 功能：将 AI Agent 的执行全过程（计划、步骤、审批、评审、日志）导出为标准化文档。
 */
import {
    META_LAST_APPROVAL_KEY,
    META_PENDING_APPROVAL_KEY,
    META_PLAN_KEY,
    META_LAST_REVIEW_KEY,
} from "./collaborationTypes";
import { getLastReviewFromRecord, getTaskPlanFromRecord } from "./collaborationService";
import type { TaskRecord, TaskTimelineEntry } from "./types";

/** 辅助函数：生成 Markdown 代码块 */
function mdCodeLang(lang: string, body: string): string {
    return "```" + lang + "\n" + body + "\n```\n";
}

/** 辅助函数：将单条时间线记录格式化为 Markdown 列表项 */
function timelineLine(e: TaskTimelineEntry): string {
    // 处理状态流转日志
    if (e.kind === "transition") {
        const r = e.reason ? ` (${e.reason})` : "";
        return `- [${e.at}] **${e.from} → ${e.to}**${r}`;
    }
    // 处理备注信息
    if (e.kind === "note") {
        return `- [${e.at}] 备注: ${e.text}`;
    }
    // 处理步骤执行记录（包含成功/失败图标）
    const ok = e.ok === false ? " ❌" : " ✅"; 
    const lbl = e.label ? ` ${e.label}` : "";
    const sum = e.summary ? ` — ${e.summary}` : "";
    return `- [${e.at}] 步骤 ${e.stepIndex}${lbl}${sum}${ok}`;
}

/**
 * 【JSON 导出】生成机器可读的完整数据包
 * 包含导出元数据，方便其他系统二次解析。
 */
export function buildTaskReportJson(task: TaskRecord): string {
    return JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            generator: "OneClaw", // 系统标识
            version: 1,
            task,                 // 原始任务全量数据
        },
        null,
        2 // 2格缩进，保证可读性
    );
}

/**
 * 【Markdown 导出】生成人类可读的精美报告
 * 适合粘贴到 Wiki、邮件或项目管理软件中。
 */
export function renderTaskReportMarkdown(task: TaskRecord): string {
    const lines: string[] = [];
    const exportedAt = new Date().toISOString();

    // 1. 标题与基本信息
    lines.push("# OneClaw 任务执行报告");
    lines.push("");
    lines.push(`- **taskId:** \`${task.taskId}\``);
    lines.push(`- **标题:** ${task.title}`);
    lines.push(`- **状态:** \`${task.status}\``);
    if (task.templateId) lines.push(`- **模板:** \`${task.templateId}\``);
    lines.push(`- **创建时间:** ${task.createdAt}`);
    lines.push(`- **最后更新:** ${task.updatedAt}`);
    
    // 2. 异常情况记录
    if (task.failureReason) lines.push(`- **失败原因:** ${task.failureReason}`);
    if (task.checkpoint) {
        const c = task.checkpoint;
        lines.push(`- **检查点:** stepIndex=${c.stepIndex}${c.label ? `, ${c.label}` : ""}, at=${c.at}`);
    }
    lines.push(`- **报告生成时间:** ${exportedAt}`);
    lines.push("");

    // 3. 核心参数展示
    lines.push("## 参数 `params`");
    lines.push(mdCodeLang("json", JSON.stringify(task.params ?? {}, null, 2)));

    // 4. 原始元数据备份
    lines.push("## 扩展元数据 `meta`（原始）");
    lines.push(mdCodeLang("json", JSON.stringify(task.meta ?? {}, null, 2)));

    // 5. 渲染执行计划（由 Planner 生成的内容）
    const plan = getTaskPlanFromRecord(task);
    if (plan) {
        lines.push("## 结构化计划 `" + META_PLAN_KEY + "`");
        lines.push("");
        if (plan.plannerNote) lines.push(`*${plan.plannerNote}*`); // 渲染 Planner 备注
        lines.push("");
        for (const s of plan.steps) {
            const r = s.risk ? ` | 风险: \`${s.risk}\`` : "";
            const st = s.status ? ` | 状态: \`${s.status}\`` : "";
            const tools = s.allowedTools?.length ? ` | 工具: \`${s.allowedTools.join(", ")}\`` : "";
            lines.push(`${s.index}. **${s.title}** — ${s.intent}${r}${st}${tools}`);
        }
        lines.push("");
    }

    // 6. 渲染评审反馈（由 Reviewer 生成的内容）
    const rev = getLastReviewFromRecord(task);
    if (rev) {
        lines.push("## 最近一次评审 `" + META_LAST_REVIEW_KEY + "`");
        lines.push("");
        lines.push(`- **结论:** \`${rev.outcome}\``);
        lines.push(`- **摘要:** ${rev.summary}`);
        lines.push(`- **时间:** ${rev.reviewedAt}`);
        if (rev.findings.length) lines.push(`- **要点:** ${rev.findings.join("；")}`);
        if (rev.resumeFromStepIndex != null) {
            lines.push(`- **建议返工步骤:** ${rev.resumeFromStepIndex}`);
        }
        lines.push("");
    }

    // 7. 安全合规：渲染审批信息（包括被拦截的操作）
    const pend = task.meta?.[META_PENDING_APPROVAL_KEY];
    if (pend && typeof pend === "object") {
        lines.push("## 待审批快照 `" + META_PENDING_APPROVAL_KEY + "`");
        lines.push(mdCodeLang("json", JSON.stringify(pend, null, 2)));
    }

    const appl = task.meta?.[META_LAST_APPROVAL_KEY];
    if (appl && typeof appl === "object") {
        lines.push("## 最近一次人工批准 `" + META_LAST_APPROVAL_KEY + "`");
        lines.push(mdCodeLang("json", JSON.stringify(appl, null, 2)));
    }

    // 8. 状态机迁移日志
    lines.push("## 状态迁移历史 `transitions`");
    lines.push("");
    if (task.transitions.length === 0) lines.push("_(无)_");
    else {
        for (const tr of task.transitions) {
            const r = tr.reason ? ` — ${tr.reason}` : "";
            lines.push(`- \`${tr.at}\` | ${tr.from} → ${tr.to}${r}`);
        }
    }
    lines.push("");

    // 9. 详细时间线（包含所有操作的颗粒度日志）
    lines.push("## 时间线 `timeline`");
    lines.push("");
    if (task.timeline.length === 0) lines.push("_(无)_");
    else for (const e of task.timeline) lines.push(timelineLine(e));

    lines.push("");
    lines.push("---");
    lines.push("*由 OneClaw V4 任务模块生成*");
    return lines.join("\n");
}

/**
 * 导出格式解析器：处理 URL 参数（如 ?format=md）
 */
export function parseExportFormat(raw: string | undefined): "json" | "md" | null {
    const s = String(raw ?? "json").trim().toLowerCase();
    if (s === "json") return "json";
    if (s === "md" || s === "markdown") return "md";
    return null;
}
