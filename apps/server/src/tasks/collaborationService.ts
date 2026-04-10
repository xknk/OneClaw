/**
 * V4 M2：协作逻辑实现
 * 核心功能：计划的格式化与持久化、评审结论的校验与任务状态机触发。
 */
import type { TraceDecisionSource } from "@/observability/traceTypes";
import type { TaskPlan, PlanStep, ReviewVerdict, TaskOrchestrationMeta } from "./collaborationTypes";
import {
    META_LAST_REVIEW_KEY,
    META_ORCHESTRATION_KEY,
    META_PLAN_KEY,
    isTaskPlan,
} from "./collaborationTypes";
import type { TaskRecord } from "./types";
import { readTask, writeTask } from "./taskStore";
import { transitionTask } from "./taskService";

/** 获取当前 ISO 格式时间戳 */
function nowIso(): string {
    return new Date().toISOString();
}

/**
 * 【数据清洗】将模型输出的原始步骤数据清洗为标准的 PlanStep 数组
 * 作用：防止 LLM 输出乱码字段，确保 index 为数字，过滤无效步骤。
 */
function normalizeSteps(raw: unknown): PlanStep[] {
    if (!Array.isArray(raw)) throw new Error("steps 必须为数组");
    const out: PlanStep[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        
        const index = Number(o.index);
        const title = typeof o.title === "string" ? o.title : "";
        const intent = typeof o.intent === "string" ? o.intent : "";
        
        // 核心校验：索引必须是有效数字，标题和意图不能为空
        if (!Number.isFinite(index) || !title.trim() || !intent.trim()) continue;

        const step: PlanStep = {
            index,
            title: title.trim(),
            intent: intent.trim(),
        };

        // 选填字段清洗：风险等级、允许工具、初始状态
        if (o.risk === "low" || o.risk === "medium" || o.risk === "high") step.risk = o.risk;
        if (Array.isArray(o.allowedTools)) {
            step.allowedTools = o.allowedTools.filter((x) => typeof x === "string") as string[];
        }
        if (o.status === "pending" || o.status === "running" || o.status === "done" || o.status === "skipped") {
            step.status = o.status;
        }
        if (typeof o.assignedAgentId === "string" && o.assignedAgentId.trim() !== "") {
            step.assignedAgentId = o.assignedAgentId.trim();
        }
        if (typeof o.role === "string" && o.role.trim() !== "") {
            step.role = o.role.trim();
        }
        out.push(step);
    }
    // 强制按索引排序，确保执行顺序正确
    out.sort((a, b) => a.index - b.index);
    if (out.length === 0) throw new Error("steps 解析后为空");
    return out;
}

/**
 * 【Planner 入口】为任务设置/更新执行计划
 */
export async function setTaskPlan(
    taskId: string,
    body: { steps: unknown; plannerNote?: string }
): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");

    const steps = normalizeSteps(body.steps);
    const plannerNote = typeof body.plannerNote === "string" ? body.plannerNote.trim() || undefined : undefined;

    const full: TaskPlan = {
        version: 1,
        steps,
        plannerNote,
        createdAt: nowIso(),
    };

    const at = nowIso();
    // 将计划存入 task 的 meta 元数据中，并记录时间线
    const meta = { ...(cur.meta ?? {}), [META_PLAN_KEY]: full };
    const timeline = [
        ...cur.timeline,
        {
            kind: "note" as const,
            at,
            text: `Planner 提交计划（${full.steps.length} 步）`,
            meta: {},
        },
    ];

    const next: TaskRecord = { ...cur, updatedAt: at, meta, timeline };
    await writeTask(next);
    return next;
}

export interface SubmitReviewBody {
    outcome: "pass" | "fail";
    summary: string;
    findings: unknown;
    resumeFromStepIndex?: number;
}

/**
 * 【Reviewer 入口】提交评审结论，并自动触发状态转换
 * 如果 pass -> 任务变为 approved（可执行）
 * 如果 fail -> 任务变为 rejected（需返工）
 */
export async function submitReviewVerdict(taskId: string, input: SubmitReviewBody): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    // 状态守卫：只有处于 review 状态的任务才能提交评审
    if (cur.status !== "review") throw new Error("仅当任务状态为 review 时可提交评审结论");

    // 校验评审参数
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    if (!summary) throw new Error("summary 必填");
    const findings = Array.isArray(input.findings)
        ? input.findings.filter((x) => typeof x === "string").map((s) => String(s).trim()).filter(Boolean)
        : [];
    if (input.outcome !== "pass" && input.outcome !== "fail") throw new Error("outcome 须为 pass 或 fail");

    const verdict: ReviewVerdict = {
        outcome: input.outcome,
        summary,
        findings,
        reviewedAt: nowIso(),
        resumeFromStepIndex:
            input.resumeFromStepIndex != null && Number.isFinite(Number(input.resumeFromStepIndex))
                ? Number(input.resumeFromStepIndex)
                : undefined,
    };

    // 1. 先保存评审结论到 meta
    const staged: TaskRecord = {
        ...cur,
        updatedAt: nowIso(),
        meta: { ...(cur.meta ?? {}), [META_LAST_REVIEW_KEY]: verdict },
    };
    await writeTask(staged);

    // 2. 根据评审结果驱动状态机
    if (input.outcome === "pass") {
        return transitionTask(taskId, {
            to: "approved",
            reason: "review_pass",
            timelineNote: `评审通过：${summary}`,
        });
    }

    // 处理失败情况：记录返工起点
    const hint =
        verdict.resumeFromStepIndex != null ? `建议从步骤 ${verdict.resumeFromStepIndex} 返工` : "需返工";
    return transitionTask(taskId, {
        to: "rejected",
        reason: "review_fail",
        timelineNote: `评审不通过：${summary}（${hint}）`,
        // 在跳转状态时携带返工提示
        meta:
            verdict.resumeFromStepIndex != null
                ? { resumeFromStepIndex: verdict.resumeFromStepIndex }
                : undefined,
    });
}

/**
 * 更新任务级编排快照（当前执行 Agent、步骤、决策来源），供多 Agent 协作审计与回放。
 */
export async function updateTaskOrchestrationSnapshot(
    taskId: string,
    input: {
        activeAgentId: string;
        activeStepIndex?: number;
        lastDecisionSource: TraceDecisionSource;
    },
    /** 若本对话轮次已持有最新 `TaskRecord`，传入可省一次 readTask */
    baseRecord?: TaskRecord | null,
): Promise<void> {
    const cur = baseRecord ?? (await readTask(taskId.trim()));
    if (!cur) return;

    const at = nowIso();
    const meta: TaskOrchestrationMeta = {
        version: 1,
        orchestrationId: taskId.trim(),
        activeAgentId: input.activeAgentId,
        activeStepIndex: input.activeStepIndex,
        lastDecisionSource: input.lastDecisionSource,
        lastHandoffAt: at,
    };

    await writeTask({
        ...cur,
        updatedAt: at,
        meta: { ...(cur.meta ?? {}), [META_ORCHESTRATION_KEY]: meta },
    });
}

/** 获取任务关联的计划 */
export function getTaskPlanFromRecord(task: TaskRecord): TaskPlan | undefined {
    const raw = task.meta?.[META_PLAN_KEY];
    return isTaskPlan(raw) ? raw : undefined;
}

/** 从已加载的任务记录解析当前 `status === running` 的步骤（无磁盘 I/O） */
export function getRunningPlanStepFromRecord(task: TaskRecord): PlanStep | null {
    const plan = getTaskPlanFromRecord(task);
    if (!plan?.steps?.length) return null;
    return plan.steps.find((s) => s.status === "running") ?? null;
}

/** 获取任务最近的一次评审结论 */
export function getLastReviewFromRecord(task: TaskRecord): ReviewVerdict | undefined {
    const raw = task.meta?.[META_LAST_REVIEW_KEY];
    if (!raw || typeof raw !== "object") return undefined;
    const o = raw as ReviewVerdict;
    // 简易结构校验
    if ((o.outcome === "pass" || o.outcome === "fail") && typeof o.summary === "string" && Array.isArray(o.findings)) {
        return o;
    }
    return undefined;
}
