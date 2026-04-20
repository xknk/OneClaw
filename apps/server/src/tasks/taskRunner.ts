import { readTask, writeTask } from "./taskStore";
import type { TaskCheckpoint, TaskRecord } from "./types";
import { getTaskPlanFromRecord } from "./collaborationService";
import type { PlanStep, TaskPlan } from "./collaborationTypes";
import { ToolPolicyGuard } from "./stepToolPolicy";
import { applyTransition } from "./stateMachine";

/**
 * 运行任务计划的配置选项
 */
export interface RunTaskPlanOptions {
    /** 链路追踪 ID，用于关联单次运行的所有日志 */
    traceId?: string;
    /** 强制指定的恢复起始步骤索引 */
    resumeFromStepIndex?: number;
    /** 幂等键，防止同一操作被重复触发 */
    idempotencyKey?: string;
    /** 
     * 执行单步逻辑的具体实现（由 Executor 提供）
     * 在此回调内部必须调用 ToolPolicyGuard.assertToolAccess 进行硬阻断
     */
    executeStep?: (input: { task: TaskRecord; step: PlanStep; traceId: string }) => Promise<void>;
}

/** 获取 ISO 格式的当前时间 */
function nowIso(): string {
    return new Date().toISOString();
}

/** 解析或生成 traceId，确保运行过程可追踪 */
function resolveTraceId(input?: string): string {
    return input?.trim() || `runner_${Date.now()}`;
}

/** 深度克隆 Plan，防止内存对象污染 */
function clonePlan(plan: TaskPlan): TaskPlan {
    return {
        ...plan,
        steps: plan.steps.map((s) => ({ ...s })),
    };
}

/** 规范化步骤状态，确保状态值在限定枚举内 */
function normalizeStepStatus(step: PlanStep): PlanStep["status"] {
    const valid = ["pending", "running", "done", "skipped"];
    if (step.status && valid.includes(step.status)) {
        return step.status;
    }
    return "pending";
}

/** 遍历计划，初始化/规范化所有步骤状态 */
function normalizePlan(plan: TaskPlan): void {
    for (const s of plan.steps) s.status = normalizeStepStatus(s);
}

/** 
 * 安全约束：确保同一时刻只有一个正在执行的步骤。
 * 防止逻辑冲突导致的数据一致性问题。
 */
function assertSingleRunning(plan: TaskPlan): void {
    const running = plan.steps.filter((s) => s.status === "running");
    if (running.length > 1) {
        throw new Error("计划非法：同一时刻存在多个 running 步骤");
    }
}

/** 
 * 决定本次运行从哪一步开始。
 * 策略：手动指定 > 寻找 running > 寻找第一个 pending > 默认末尾。
 */
function pickStartIndex(plan: TaskPlan, resumeFromStepIndex?: number): number {
    if (resumeFromStepIndex != null) {
        const idx = Number(resumeFromStepIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= plan.steps.length) {
            throw new Error(`resumeFromStepIndex 无效: ${resumeFromStepIndex}`);
        }
        return idx;
    }

    const runningIdx = plan.steps.findIndex((s) => s.status === "running");
    if (runningIdx >= 0) return runningIdx;

    const pendingIdx = plan.steps.findIndex((s) => s.status === "pending");
    if (pendingIdx >= 0) return pendingIdx;

    return plan.steps.length;
}

/** 
 * 在 Timeline 中追加一条结构化记录并持久化任务 
 * 用于 UI 展示和审计跟踪
 */
async function appendNote(task: TaskRecord, text: string, meta: Record<string, unknown>): Promise<TaskRecord> {
    const at = nowIso();
    const next: TaskRecord = {
        ...task,
        updatedAt: at,
        timeline: [...(task.timeline || []), { kind: "note", at, text, meta }],
    };
    await writeTask(next);
    return next;
}

/** 
 * 将 Plan 的最新状态（步骤进度等）持久化到 TaskRecord 的 meta 字段 
 * 这是断点恢复的关键数据源
 */
async function persistPlan(task: TaskRecord, plan: TaskPlan): Promise<TaskRecord> {
    const at = nowIso();
    const next: TaskRecord = {
        ...task,
        updatedAt: at,
        meta: { ...(task.meta ?? {}), v4_plan: plan },
    };
    await writeTask(next);
    return next;
}

/** 构造 Checkpoint 载荷（不含时间戳，时间戳在 markFailed 中生成） */
function buildCheckpoint(stepIndex: number, traceId: string, idempotencyKey: string): Omit<TaskCheckpoint, "at"> {
    return {
        stepIndex,
        label: "runner_checkpoint",
        payload: {
            traceId,
            idempotencyKey,
        },
    };
}

/** 
 * 任务失败终态处理
 * 记录失败原因、保存 Checkpoint、转换任务状态
 */
/** 步骤失败但希望用户补充信息：任务进入 pending_approval，保留计划与 checkpoint */
async function pauseForUserAfterStepFail(
    task: TaskRecord,
    plan: TaskPlan,
    failureReason: string,
    checkpoint: Omit<TaskCheckpoint, "at">,
    traceId: string,
    stepIndex: number
): Promise<TaskRecord> {
    const cur = await persistPlan(task, plan);
    const next = applyTransition(cur, "pending_approval", {
        reason: "step_failed_await_user",
        timelineNote: `步骤 ${stepIndex} 执行失败，请先补充信息或调整后从本步重试：${failureReason.slice(0, 400)}`,
        checkpoint: { ...checkpoint, at: nowIso() },
        meta: { traceId, stepIndex, stepFailedAwaitUser: true },
    });
    await writeTask(next);
    return next;
}

async function markFailed(
    task: TaskRecord,
    failureReason: string,
    checkpoint: Omit<TaskCheckpoint, "at">,
    meta: Record<string, unknown>
): Promise<TaskRecord> {
    const at = nowIso();
    const next: TaskRecord = {
        ...task,
        status: "failed",
        failureReason,
        checkpoint: { ...checkpoint, at },
        updatedAt: at,
        transitions: [
            ...(task.transitions || []),
            { at, from: task.status, to: "failed", reason: failureReason, meta },
        ],
        timeline: [
            ...(task.timeline || []),
            { kind: "note", at, text: "step_failed", meta },
        ],
    };
    await writeTask(next);
    return next;
}

/** 确保任务进入 running 状态（如果当前不是 running） */
async function ensureRunning(task: TaskRecord): Promise<TaskRecord> {
    if (task.status === "running") return task;
    const at = nowIso();
    const next: TaskRecord = {
        ...task,
        status: "running",
        updatedAt: at,
        transitions: [
            ...(task.transitions || []),
            { at, from: task.status, to: "running", reason: "runner_start" },
        ],
    };
    await writeTask(next);
    return next;
}

/** 
 * 任务成功终态处理
 * 清除 Checkpoint 和错误信息，完成状态转换
 */
async function markDone(task: TaskRecord, traceId: string): Promise<TaskRecord> {
    const at = nowIso();
    const next: TaskRecord = {
        ...task,
        status: "done",
        failureReason: undefined,
        checkpoint: undefined,
        updatedAt: at,
        transitions: [
            ...(task.transitions || []),
            { at, from: task.status, to: "done", reason: "runner_completed", meta: { traceId } },
        ],
        timeline: [
            ...(task.timeline || []),
            { kind: "note", at, text: "runner_done", meta: { traceId } },
        ],
    };
    await writeTask(next);
    return next;
}

/**
 * [核心主入口] 运行任务计划
 * 实现从 pre-check 到执行循环再到异常捕获的全生命周期管理
 */
export async function runTaskPlan(taskId: string, options: RunTaskPlanOptions = {}): Promise<TaskRecord> {
    const rec = await readTask(taskId.trim());
    if (!rec) throw new Error("任务不存在");

    const traceId = resolveTraceId(options.traceId);
    const idempotencyKey = options.idempotencyKey?.trim() || `${taskId}:${traceId}`;

    // 1. 获取并解包 Plan
    const rawPlan = getTaskPlanFromRecord(rec);
    if (!rawPlan || !Array.isArray(rawPlan.steps) || rawPlan.steps.length === 0) {
        throw new Error("v4_plan 缺失或为空，拒绝执行（fail closed）");
    }

    const plan = clonePlan(rawPlan);
    normalizePlan(plan);
    assertSingleRunning(plan);

    // 2. [Runner 预检]: 强校验。如果步骤定义的白名单或基础字段有误，任务在此直接阻断。
    for (const s of plan.steps) {
        ToolPolicyGuard.validateStepContract(s);
    }
    for (const s of plan.steps) {
        if (s.onStepFail === "goto_step") {
            const t = s.onFailGotoStepIndex;
            if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t >= plan.steps.length) {
                throw new Error(
                    `步骤 ${s.index}：onFailGotoStepIndex 无效（需 0..${plan.steps.length - 1} 的整数）`
                );
            }
        }
    }

    // 3. 准备运行环境
    let cur = await ensureRunning(rec);
    cur = await persistPlan(cur, plan);

    // 4. 定位起点（支持恢复）
    let idx = pickStartIndex(plan, options.resumeFromStepIndex);

    // 检查是否已经执行完所有步骤
    if (idx >= plan.steps.length) {
        if (plan.steps.every((s) => s.status === "done" || s.status === "skipped")) {
            return markDone(cur, traceId);
        }
        return cur;
    }

    // 5. 执行循环
    while (idx < plan.steps.length) {
        const step = plan.steps[idx];
        if (!step) break;

        // [恢复幂等]: 跳过已完成或无需执行的步骤
        if (step.status === "done" || step.status === "skipped") {
            idx++;
            continue;
        }

        // 状态独占：将当前步骤设为 running，其余非完成步骤设为 pending
        for (const s of plan.steps) {
            if (s.index !== step.index && s.status === "running") s.status = "pending";
        }
        step.status = "running";

        // 执行前存盘：确保异常宕机后，重启能知道哪一步正在跑
        cur = await persistPlan(cur, plan);
        cur = await appendNote(cur, "step_start", { traceId, stepIndex: step.index });

        try {
            // [调用执行器]: 在此回调内部必须包含具体的 ToolPolicyGuard.assertToolAccess 校验
            if (!options.executeStep) {
                // 无内置执行器（例如仅通过 WebChat 调工具）：不要把本步标成 done。
                // 否则「运行」按钮会空转完成所有步骤，导致 M2 对话侧找不到 status=running 的步骤。
                cur = await appendNote(cur, "runner_wait_webchat", {
                    traceId,
                    stepIndex: step.index,
                });
                return cur;
            }

            await options.executeStep({ task: cur, step, traceId });

            // 步骤执行成功
            step.status = "done";
            cur = await persistPlan(cur, plan);
            cur = await appendNote(cur, "step_done", { traceId, stepIndex: step.index });
            idx++;
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            const cp = buildCheckpoint(step.index, traceId, idempotencyKey);
            const strategy = step.onStepFail ?? "fail_task";

            if (strategy === "ask_user") {
                step.status = "pending";
                return pauseForUserAfterStepFail(cur, plan, reason, cp, traceId, step.index);
            }

            if (strategy === "goto_step" && typeof step.onFailGotoStepIndex === "number") {
                const target = step.onFailGotoStepIndex;
                if (target >= 0 && target < plan.steps.length) {
                    step.status = "pending";
                    const targetStep = plan.steps[target];
                    if (targetStep) targetStep.status = "pending";
                    cur = await persistPlan(cur, plan);
                    cur = await appendNote(cur, "step_fail_goto", {
                        traceId,
                        fromStep: step.index,
                        toStep: target,
                        reason: reason.slice(0, 500),
                    });
                    idx = target;
                    continue;
                }
            }

            step.status = "pending";
            cur = await persistPlan(cur, plan);
            return markFailed(cur, reason, cp, {
                traceId,
                stepIndex: step.index,
                idempotencyKey,
            });
        }
    }

    // 7. 终态判定：如果全部步骤完成，则 markDone
    if (plan.steps.every((s) => s.status === "done" || s.status === "skipped")) {
        return markDone(cur, traceId);
    }
    return cur;
}

/**
 * [恢复入口]: 从任务最近一次的失败点（Checkpoint）重新启动
 */
export async function resumeTaskFromCheckpoint(
    taskId: string,
    options: Omit<RunTaskPlanOptions, "resumeFromStepIndex"> & { stepIndex?: number } = {}
): Promise<TaskRecord> {
    const rec = await readTask(taskId.trim());
    if (!rec) throw new Error("任务不存在");

    // 优先级：参数指定索引 > 任务记录中存的索引
    const stepIndex = options.stepIndex ?? rec.checkpoint?.stepIndex;
    if (stepIndex === undefined || !Number.isFinite(stepIndex)) {
        throw new Error("checkpoint 无效或缺失，无法恢复");
    }

    const traceId = resolveTraceId(options.traceId);
    let task = await appendNote(rec, "resume_from_checkpoint", { traceId, stepIndex });

    // 先确保任务状态变更为运行中
    task = await ensureRunning(task);

    // 重新触发执行流程，并传入起始索引
    return runTaskPlan(task.taskId, {
        ...options,
        traceId,
        resumeFromStepIndex: Number(stepIndex),
    });
}

/** 
 * 运行任务
 * 用于在非任务计划执行场景下，直接触发任务运行
 */
export async function runTask(taskId: string, traceId?: string): Promise<TaskRecord> {
    return runTaskPlan(taskId, { traceId });
}