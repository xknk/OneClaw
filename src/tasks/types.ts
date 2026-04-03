/**
 * V4 任务工作流：类型定义（PRD M1）
 */

/**
 * 任务生命周期的所有可能状态
 * 涵盖了从草稿、运行、人工审批到最终完成或失败的全过程
 */
export type TaskStatus =

    | "draft"            // 草稿：任务刚创建，尚未开始执行
    | "planned"          // 已规划：任务已确认，等待队列调度
    | "running"          // 运行中：任务正在执行

    | "pending_approval" // 待审批：执行中需要人工干预/授权
    | "review"           // 复核中：任务执行完毕，等待结果人工确认
    | "approved"         // 已通过：审批通过

    | "rejected"         // 已拒绝：审批被驳回
    | "done"             // 已完成：任务成功结束
    | "failed"           // 已失败：执行出错且无法自动恢复

    | "cancelled";       // 已取消：用户手动停止

/**
 * 状态流转记录
 * 用于精确追踪任务是如何从 A 状态变为 B 状态的
 */
export interface TaskStateTransition {
    at: string;          // 变更发生的时间戳（ISO 字符串）
    from: TaskStatus;    // 变更前的状态
    to: TaskStatus;      // 变更后的状态
    reason?: string;     // 变更原因（如：用户手动取消、系统报错内容）
    meta?: Record<string, unknown>; // 扩展元数据（如：执行变更的用户 ID）
}

/**
 * 任务时间轴条目（联合类型）
 * 用于在前端 UI 展示类似“操作日志”或“执行进度”的列表
 */
export type TaskTimelineEntry =
    | {
          kind: "transition"; // 类型 1：状态变更
          at: string;
          from: TaskStatus;
          to: TaskStatus;
          reason?: string;
          meta?: Record<string, unknown>;
      }

    | {
          kind: "note";       // 类型 2：备注/日志（纯文本记录）
          at: string;
          text: string;
          meta?: Record<string, unknown>;
      }
    | {
          kind: "step";       // 类型 3：执行步骤（如：步骤 1/5 成功）
          at: string;
          stepIndex: number;  // 步骤索引
          label?: string;     // 步骤名称
          summary?: string;   // 步骤执行摘要
          ok?: boolean;       // 是否成功
          durationMs?: number;// 耗时（毫秒）
          meta?: Record<string, unknown>;
      };

/**
 * 任务检查点
 * 用于记录长耗时任务的断点信息，方便失败后从该位置重试
 */
export interface TaskCheckpoint {
    stepIndex: number;    // 当前执行到的步骤索引
    label?: string;       // 检查点名称
    payload?: Record<string, unknown>; // 恢复任务所需的快照数据
    at: string;           // 记录时间
}

/**
 * 任务记录完整实体
 * 数据库中存储的最终对象格式
 */
export interface TaskRecord {
    taskId: string;       // 任务唯一 ID
    title: string;        // 任务标题
    status: TaskStatus;   // 当前实时状态
    createdAt: string;    // 创建时间
    updatedAt: string;    // 最后更新时间
    failureReason?: string; // 如果失败，记录错误简述
    checkpoint?: TaskCheckpoint; // 当前最新的检查点
    transitions: TaskStateTransition[]; // 状态流转历史（数组）
    timeline: TaskTimelineEntry[];      // 完整时间轴（数组）
    templateId?: string;  // 关联的任务模板 ID
    params?: Record<string, unknown>;   // 启动任务时的输入参数
    meta?: Record<string, unknown>;     // 任务级别的扩展元数据
}

/**
 * 创建任务时的输入参数
 */
export interface CreateTaskInput {
    title?: string;
    templateId?: string;
    params?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}

/**
 * 触发任务状态变更时的输入参数
 */
export interface TransitionTaskInput {
    to: TaskStatus;       // 目标状态
    reason?: string;      // 变更原因
    meta?: Record<string, unknown>; // 附加元数据
    checkpoint?: Omit<TaskCheckpoint, "at">; // 可选：更新检查点（不需传时间，由后端生成）
    timelineNote?: string; // 可选：在时间轴自动插入一条 note
    failureReason?: string; // 可选：如果是变为 failed 状态，需提供错误信息
}

/**
 * 任务列表查询过滤条件
 */
export interface ListTasksQuery {
    limit?: number;       // 分页限制
    status?: TaskStatus;  // 按状态过滤
    failedOnly?: boolean; // 快速筛选所有失败的任务
}
