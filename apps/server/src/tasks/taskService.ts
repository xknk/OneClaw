import { applyTransition } from "./stateMachine";
import type {
    CreateTaskInput,
    ListTasksQuery,
    TaskCheckpoint,
    TaskRecord,
    TaskStatus,
    TransitionTaskInput,
} from "./types";
import {
    listTasks as listTasksFromStore,
    newTaskId,
    readTask,
    writeTask,
    deleteTaskFile,
} from "./taskStore";
import { mergeCreateInputWithTemplate } from "./templates";
import {
    META_LAST_FAILURE_CONTEXT_KEY,
    META_PLAN_KEY,
    type TaskLastFailureContext,
    type TaskPlan,
} from "./collaborationTypes";
import { getRunningPlanStepFromRecord, getTaskPlanFromRecord } from "./collaborationService";
import { validateMergedTemplateParams } from "./templateValidation";
import { runTaskPlan, resumeTaskFromCheckpoint } from "./taskRunner";

/** 内部工具：获取当前时间的 ISO 字符串 */
function nowIso(): string {
    return new Date().toISOString();
}

function statusZh(status: TaskStatus): string {
    switch (status) {
        case "draft": return "草稿";
        case "planned": return "已计划";
        case "running": return "运行中";
        case "pending_approval": return "待审批";
        case "review": return "评审中";
        case "approved": return "已通过";
        case "rejected": return "已拒绝";
        case "done": return "已完成";
        case "failed": return "失败";
        case "cancelled": return "已取消";
    }
}

/**
 * 创建新任务
 * 默认状态为 'draft'，并初始化第一条时间轴记录
 */
export async function createTask(input: CreateTaskInput = {}): Promise<TaskRecord> {
    const merged = mergeCreateInputWithTemplate(input);
    validateMergedTemplateParams(merged);

    const at = nowIso();
    const taskId = newTaskId();
    const rec: TaskRecord = {
        taskId,
        // 限制标题长度防止溢出，并提供默认值
        title: (merged.title?.trim() || "未命名任务").slice(0, 500),
        status: "draft",
        createdAt: at,
        updatedAt: at,
        transitions: [], // 初始流转记录为空
        timeline: [
            {
                kind: "note",
                at,
                text: merged.templateId ? `任务已创建（模板：${merged.templateId}）` : "任务已创建",
                meta: {},
            },
        ],
        templateId: merged.templateId?.trim() || undefined,
        params: merged.params,
        meta: merged.meta,
    };
    await writeTask(rec);
    return rec;
}

/** 获取单个任务详情 */
export async function getTask(taskId: string): Promise<TaskRecord | null> {
    return readTask(taskId.trim());
}

export async function updateTaskTitle(taskId: string, title: string): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    const nextTitle = title.trim().slice(0, 500);
    if (!nextTitle) {
        throw new Error("标题不能为空");
    }
    if (nextTitle === cur.title) {
        return cur;
    }
    const at = nowIso();
    const timeline = [
        ...cur.timeline,
        {
            kind: "note" as const,
            at,
            text: `标题已更新：${cur.title} → ${nextTitle}`,
            meta: { source: "updateTaskTitle" },
        },
    ];
    const next: TaskRecord = { ...cur, title: nextTitle, updatedAt: at, timeline };
    await writeTask(next);
    return next;
}

/** 从磁盘删除任务记录（不可恢复） */
export async function deleteTaskPermanently(taskId: string): Promise<void> {
    const ok = await deleteTaskFile(taskId);
    if (!ok) throw new Error("任务不存在");
}

/** 获取任务列表（直接透传查询条件给存储层） */
export async function listTasks(query: ListTasksQuery = {}): Promise<TaskRecord[]> {
    return listTasksFromStore(query);
}

/**
 * 核心：变更任务状态
 * 该函数会调用状态机检查合法性，并自动持久化更新后的结果
 */
export async function transitionTask(
    taskId: string,
    input: TransitionTaskInput
): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");

    // 调用状态机逻辑获取更新后的对象
    const next = applyTransition(cur, input.to, {
        reason: input.reason,
        meta: input.meta,
        failureReason: input.failureReason,
        // 如果传入了 checkpoint，补充当前时间戳
        checkpoint: input.checkpoint
            ? { ...input.checkpoint, at: nowIso() }
            : undefined,
        timelineNote: input.timelineNote,
    });

    await writeTask(next);
    return next;
}

/** 快捷接口：取消任务 */
export async function cancelTask(taskId: string, reason?: string): Promise<TaskRecord> {
    return transitionTask(taskId, {
        to: "cancelled",
        reason: reason ?? "cancelled_by_user",
        timelineNote: reason ? `取消：${reason}` : "任务已取消",
    });
}

/** 快捷接口：标记任务失败 */
/** 快捷接口：标记任务失败 */
export async function failTask(
    taskId: string,
    failureReason: string,
    opts: {
        checkpoint?: Omit<TaskCheckpoint, "at">;
        meta?: Record<string, unknown>;
        traceId?: string;
    } = {}
): Promise<TaskRecord> {
    // 1. 获取任务详情
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    // 2. 获取最后一条工具执行步骤
    const stepEntries = cur.timeline.filter((e) => e.kind === "step");
    const lastTool =
        stepEntries.length > 0 ? stepEntries[stepEntries.length - 1] : undefined;
    const lastToolStepIndex =
        lastTool?.kind === "step" ? lastTool.stepIndex : undefined;
    // 3. 获取当前时间戳
    const at = nowIso();
    // 4. 获取调用方标识
    const src =
        opts.meta && typeof opts.meta.source === "string"
            ? String(opts.meta.source) // 调用方标识
            : "failTask"; // 默认调用方标识
    // 5. 构建排障上下文
    const ctx: TaskLastFailureContext = { at, source: src, traceId: opts.traceId, lastToolStepIndex, errorBrief: failureReason.slice(0, 500) };
    // 6. 更新任务
    return transitionTask(taskId, {
        to: "failed",
        failureReason,
        reason: failureReason,
        checkpoint: opts.checkpoint,
        meta: {
            ...(opts.meta ?? {}),
            [META_LAST_FAILURE_CONTEXT_KEY]: ctx,
        },
        timelineNote: `失败：${failureReason}`,
    });
}

/** 
 * 快捷接口：重试任务
 * 逻辑上仅允许从 failed 状态迁移到 running
 */
export async function retryTask(taskId: string, reason?: string): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    if (cur.status !== "failed") {
        throw new Error(`仅「失败」状态任务可重试（当前状态：${statusZh(cur.status)}）。`);
    }
    // 1. 状态迁移
    const moved = await transitionTask(taskId, {
        to: "running",
        reason: reason ?? "retry",
        timelineNote: reason ? `重试：${reason}` : "重试执行",
    });
    // 仅当存在有效 v4_plan 时才进入 Runner；无计划时保持兼容（仅切回 running）
    const plan = getTaskPlanFromRecord(moved);
    if (!plan?.steps?.length) return moved;
    return runTaskPlan(moved.taskId, {
        traceId: `retry_${Date.now()}`,
    });
}

/** 
 * 快捷接口：从特定检查点恢复执行
 * 通常用于长流程 AI 任务在某个中间步骤出错后的恢复
 */
export async function resumeFromCheckpoint(
    taskId: string,
    checkpoint: Omit<TaskCheckpoint, "at">
): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    if (cur.status !== "failed") {
        throw new Error(`仅「失败」状态任务可从检查点恢复为「运行中」（当前状态：${statusZh(cur.status)}）。`);
    }
    const moved = await transitionTask(taskId, {
        to: "running",
        reason: "resume_from_checkpoint",
        checkpoint,
        timelineNote: `从步骤 ${checkpoint.stepIndex} 恢复`,
    });
    const plan = getTaskPlanFromRecord(moved);
    if (!plan?.steps?.length) return moved;
    return resumeTaskFromCheckpoint(moved.taskId, {
        stepIndex: checkpoint.stepIndex,
        traceId: `resume_${Date.now()}`,
    });
}

/** 
 * 增强接口：原地追加一条时间轴备注（不触发状态迁移）
 * 适用于在执行过程中异步记录中间日志
 */
export async function appendTimelineNote(
    taskId: string,
    text: string,
    meta?: Record<string, unknown>
): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    const at = nowIso();
    const timeline = [
        ...cur.timeline,
        { kind: "note" as const, at, text: text.trim(), meta: meta ?? {} },
    ];
    // 手动构造更新后的对象并保存
    const next: TaskRecord = { ...cur, updatedAt: at, timeline };
    await writeTask(next);
    return next;
}

/** 追加一条「工具执行」时间轴步骤（与 trace / 工具审计对齐，不触发状态迁移） */
export async function appendTimelineToolStep(
    taskId: string,
    input: {
        traceId: string;
        toolName: string;
        ok: boolean;
        durationMs: number;
        /** 展示用标签，默认 toolName */
        label?: string;
        /** 一行摘要，默认用 toolName + 成败 + 耗时 */
        summary?: string;
        meta?: Record<string, unknown>;
    }
): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    const at = nowIso();
    const prevSteps = cur.timeline.filter((e) => e.kind === "step").length;
    const stepIndex = prevSteps + 1;
    const label = input.label?.trim() || input.toolName;
    const summary =
        input.summary?.trim() ||
        `${input.toolName} — ${input.ok ? "ok" : "失败"} (${input.durationMs}ms)`;
    const timeline = [
        ...cur.timeline,
        {
            kind: "step" as const,
            at,
            stepIndex,
            label,
            summary,
            ok: input.ok,
            durationMs: input.durationMs,
            meta: {
                traceId: input.traceId,
                toolName: input.toolName,
                ...(input.meta ?? {}),
            },
        },
    ];
    const next: TaskRecord = { ...cur, updatedAt: at, timeline };
    await writeTask(next);
    return next;
}
/**
 * 字符串解析工具：将任意字符串安全地转换为有效的 TaskStatus 类型
 * 如果输入非法，则返回 undefined，常用于解析 API URL 参数
 */
export function parseTaskStatus(raw: string | undefined): TaskStatus | undefined {
    if (!raw || !raw.trim()) return undefined;
    const s = raw.trim() as TaskStatus;
    const all: TaskStatus[] = [
        "draft", "planned", "running", "pending_approval",
        "review", "approved", "rejected", "done", "failed", "cancelled",
    ];
    return all.includes(s) ? s : undefined;
}

/**
 * WebChat 接入时修复「任务为 running，但 v4_plan 中没有任何 running 步」的失步状态。
 * 否则 m2 步骤工具策略会判定 STEP_INVALID，模型无法调用任何工具。
 *
 * 策略：优先将第一个 pending 标为 running；若无 pending 且存在 done，则将最后一个 done 恢复为 running（常见于误标或仅对话未真实执行工具）。
 */
async function repairPlanRunningStepIfNeeded(task: TaskRecord): Promise<TaskRecord> {
    if (task.status !== "running") return task;
    const plan = getTaskPlanFromRecord(task);
    if (!plan?.steps?.length) return task;
    if (getRunningPlanStepFromRecord(task)) return task;

    const steps = plan.steps.map((s) => ({ ...s }));
    let note: string | undefined;

    const pendingIdx = steps.findIndex((s) => (s.status ?? "pending") === "pending");
    if (pendingIdx >= 0) {
        steps[pendingIdx] = { ...steps[pendingIdx], status: "running" };
        note = `计划步骤自动修复：步骤 ${steps[pendingIdx].index}（${steps[pendingIdx].title}）从 pending 进入 running`;
    } else {
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].status === "done") {
                steps[i] = { ...steps[i], status: "running" };
                note = `计划步骤自动修复：步骤 ${steps[i].index}（${steps[i].title}）曾标记为 done，与运行中任务不一致，已恢复为 running 以继续执行`;
                break;
            }
        }
    }

    if (!note) return task;

    const newPlan: TaskPlan = { ...plan, steps };
    const at = nowIso();
    const next: TaskRecord = {
        ...task,
        updatedAt: at,
        meta: { ...(task.meta ?? {}), [META_PLAN_KEY]: newPlan },
        timeline: [
            ...(task.timeline ?? []),
            {
                kind: "note",
                at,
                text: note,
                meta: { source: "repairPlanRunningStepIfNeeded" },
            },
        ],
    };
    await writeTask(next);
    return next;
}

/** 
 * 【任务预处理结果接口】
 * 用于定义在对话周期内，系统应该如何对待关联的任务（TaskRecord）。
 */
export interface PrepareTaskForChatResult {
    /** 
     * 处理后的任务快照。
     * 如果 taskId 无效或任务不存在，则为 null。
     */
    record: TaskRecord | null;

    /**
     * 钩子激活开关。
     * true: 允许 Agent 在回复后向任务时间线写入“已回复”或“执行中”等记录。
     * false: 无任务或已取消等，不向时间线写入。
     * 注意：任务为 done 时可为 true 且配合 notesOnly，仅追加时间线备注而不改任务主状态。
     */
    hooksEnabled: boolean;

    /**
     * 仅备注模式。
     * true: 任务处于敏感状态（如待审批）。此时 AI 的回复只能作为备注存入时间线，
     *      绝对不允许调用 failTask 或 transitionTask 来改变任务的主状态。
     */
    notesOnly: boolean;
}

/**
 * 【对话轮次任务准备函数】
 * 在 runAgent 核心逻辑执行前调用。
 * 作用：像“自动挡转换器”一样，根据对话接入动作，将任务推到最合适的执行状态。
 * 
 * @param taskId - 外部传入的任务 ID
 */
export async function prepareTaskForChatRound(taskId: string): Promise<PrepareTaskForChatResult> {
    // 1. 获取任务详情：若 ID 没传或找不到，直接返回“无任务”模式
    let t = await getTask(taskId.trim());
    if (!t) {
        return { record: null, hooksEnabled: false, notesOnly: false };
    }

    // 2. 终态拦截：已完成任务仍允许向时间线追加记录（仅备注，不改状态），便于后续对话与工具可在时间轴追溯
    if (t.status === "done") {
        return { record: t, hooksEnabled: true, notesOnly: true };
    }
    if (t.status === "cancelled") {
        return { record: t, hooksEnabled: false, notesOnly: false };
    }

    // 3. 敏感状态保护：任务正在“审批中”或“评审中”。
    // 允许记录对话内容到时间线（hooksEnabled: true），但严禁修改状态（notesOnly: true）。
    if (t.status === "pending_approval" || t.status === "review" || t.status === "approved") {
        return { record: t, hooksEnabled: true, notesOnly: true };
    }

    // --- 以下为自动状态迁移逻辑 (State Transition) ---

    // 4. 草稿态自动激活：draft -> planned
    if (t.status === "draft") {
        t = await transitionTask(taskId, {
            to: "planned",
            reason: "chat_round",
            timelineNote: "进入规划（WebChat 接入）",
        });
    }

    // 5. 规划态/拒绝态转为执行中：planned/rejected -> running
    // 意味着用户一旦开始聊天，任务就正式“开工”了。
    if (t.status === "planned") {
        t = await transitionTask(taskId, {
            to: "running",
            reason: "chat_round",
            timelineNote: "开始执行（WebChat）",
        });
    }

    // 6. 失败重试逻辑：若任务之前报错了，聊天接入会自动触发重试机制
    if (t.status === "failed") {
        t = await retryTask(taskId, "chat_round_resume");
    }

    // 7. 驳回回炉：如果任务被拒绝了，重新进入运行状态进行返工
    if (t.status === "rejected") {
        t = await transitionTask(taskId, {
            to: "running",
            reason: "chat_round",
            timelineNote: "返工（WebChat）",
        });
    }

    // 8. 默认返回：此时任务通常已处于 running 状态，允许全权操作（改状态+记笔记）
    if (t.status === "running") {
        t = await repairPlanRunningStepIfNeeded(t);
    }
    return { record: t, hooksEnabled: true, notesOnly: false };
}
