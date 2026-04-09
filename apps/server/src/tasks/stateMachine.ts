import type { TaskRecord, TaskStatus } from "./types";
import { META_APPROVAL_GRANTS_KEY, META_LAST_FAILURE_CONTEXT_KEY } from "./collaborationTypes";
/**
 * 定义“终态”列表
 * 任务一旦进入这些状态，通常意味着流程结束，不再接受常规的业务逻辑流转
 */
const TERMINAL: TaskStatus[] = ["done", "cancelled"];

/**
 * 判断当前状态是否为终态
 */
function isTerminal(status: TaskStatus): boolean {
    return TERMINAL.includes(status);
}

/**
 * 核心状态机配置：定义每个状态允许跳往的下一个状态
 * 这是一个典型的“有向图”结构
 */
const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
    // 草稿态：可进入规划，或直接取消
    draft: ["planned", "cancelled"],
    // 已规划：可开始执行，或取消
    planned: ["running", "cancelled"],
    // 运行中：可进入人工审批、复核、失败或取消
    running: ["review", "pending_approval", "failed", "cancelled"],
    // 待审批：审批后通常回到运行态继续执行
    pending_approval: ["running", "cancelled"],
    // 复核中：可被批准、拒绝（驳回）、失败或取消
    review: ["approved", "rejected", "failed", "cancelled"],
    // 已通过：通往成功终点
    approved: ["done", "cancelled"],
    // 被拒绝：可重回运行态或规划态尝试修复
    rejected: ["running", "planned", "cancelled"],
    // 终态（Done/Cancelled）：不允许再往任何状态跳（对应空数组）
    done: [],
    // 失败态：允许重试（回到运行或规划态）
    failed: ["running", "planned", "cancelled"],
    cancelled: [],
};

/**
 * 断言状态转换是否合法
 * 如果不合法则抛出错误，防止业务逻辑产生非法状态（如从“已完成”跳回“运行中”）
 */
export function assertTransitionAllowed(from: TaskStatus, to: TaskStatus): void {
    // 状态未改变，直接忽略
    if (from === to) return;

    // 安全检查：防止从终态意外跳出（除非业务允许重连，但此处逻辑禁止）
    if (isTerminal(from) && !isTerminal(to)) {
        throw new Error(`任务已处于终态 ${from}，不可迁移到 ${to}`);
    }

    // 查找状态机配置，验证目标状态是否在允许列表中
    const next = ALLOWED[from];
    if (!next?.includes(to)) {
        throw new Error(`不允许从 ${from} 迁移到 ${to}`);
    }
}

/**
 * 执行状态转换的核心函数（纯函数）
 * 根据输入的新状态和参数，返回一个新的 TaskRecord 副本，而不修改原始对象（Immutable 模式）
 */
export function applyTransition(
    task: TaskRecord,
    to: TaskStatus,
    opts: {
        at?: string;                // 转换发生时间
        reason?: string;            // 转换原因
        meta?: Record<string, unknown>; // 扩展数据
        failureReason?: string;     // 失败时的详细描述
        checkpoint?: TaskRecord["checkpoint"]; // 可选更新检查点
        timelineNote?: string;      // 可选在时间轴添加额外备注
    } = {}
): TaskRecord {
    const at = opts.at ?? new Date().toISOString();
    const from = task.status;

    // 1. 首先进行合法性校验
    assertTransitionAllowed(from, to);

    // 2. 构造转换记录对象
    const transition = {
        at,
        from,
        to,
        reason: opts.reason,
        meta: opts.meta,
    };

    // 3. 构建新的时间轴（Timeline）
    const timeline = [...task.timeline];
    // 添加状态转换条目
    timeline.push({
        kind: "transition",
        at,
        from,
        to,
        reason: opts.reason,
        meta: opts.meta,
    });
    // 如果提供了额外的备注信息，插入一条 note 类型条目
    if (opts.timelineNote?.trim()) {
        timeline.push({
            kind: "note",
            at,
            text: opts.timelineNote.trim(),
            meta: opts.meta,
        });
    }

    // 4. 处理失败原因逻辑
    let failureReason = task.failureReason;
    if (to === "failed") {
        // 进入失败态，记录错误原因
        failureReason = opts.failureReason ?? opts.reason ?? "unknown";
    } else if (to === "running" && from === "failed") {
        // 从失败态恢复到运行态，清除旧的错误原因
        failureReason = undefined;
    }

    // 5. 更新检查点（Checkpoint）
    let checkpoint = task.checkpoint;
    if (opts.checkpoint) {
        checkpoint = { ...opts.checkpoint, at };
    }
    
    // 6. task.meta：失败时合并 opts.meta；终局清 grants；从 failed 恢复 running 时清失败快照
    let meta: Record<string, unknown> = task.meta ? { ...task.meta } : {};
    if (to === "failed" && opts.meta && Object.keys(opts.meta).length > 0) {
        meta = { ...meta, ...opts.meta };
    }
    if ((to === "done" || to === "failed" || to === "cancelled") && meta[META_APPROVAL_GRANTS_KEY] !== undefined) {
        delete meta[META_APPROVAL_GRANTS_KEY];
    }
    if (to === "running" && from === "failed") {
        failureReason = undefined;
        if (meta[META_LAST_FAILURE_CONTEXT_KEY] !== undefined) {
            delete meta[META_LAST_FAILURE_CONTEXT_KEY];
        }
    }
    // 7. 返回合并后的新 TaskRecord 实体
    return {
        ...task,
        meta,
        status: to,
        updatedAt: at,
        failureReason,
        checkpoint,
        transitions: [...task.transitions, transition],
        timeline,
    };
}
