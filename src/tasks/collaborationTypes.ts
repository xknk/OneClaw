/**
 * V4 M2：Planner / Executor / Reviewer 结构化中间协议
 * 核心逻辑：解耦“想、做、评”三个环节，通过元数据（Meta）持久化任务状态。
 */

// 常量定义：用于在数据库或上下文对象中存取对应的 JSON 字符串
export const META_PLAN_KEY = "v4_plan";            // 存储生成的计划
export const META_LAST_REVIEW_KEY = "v4_last_review"; // 存储最近一次的审核结论
export const META_PENDING_APPROVAL_KEY = "v4_pending_approval"; // 存储待审批的高风险工具
export const META_LAST_APPROVAL_KEY = "v4_last_approval"; // 存储最近一次的人工批准
/** 已批准在本任务存续期内可重复调用的高风险工具名（至任务 done/failed/cancelled 清除） */
export const META_APPROVAL_GRANTS_KEY = "v4_approval_grants";
/** 最近一次失败时的排障上下文（与 trace / timeline step 对齐） */
export const META_LAST_FAILURE_CONTEXT_KEY = "v4_last_failure_context";

/** 已批准在本任务存续期内可重复调用的高风险工具名（至任务 done/failed/cancelled 清除） */
export interface TaskApprovalGrants {
    toolNames: string[];
    updatedAt: string;
}

export interface TaskLastFailureContext {
    at: string;
    /** 如 WebChat 一轮的 traceId */
    traceId?: string;
    /** 调用方标识，如 handleUnifiedChat / failTask */
    source: string;
    /** timeline 里最后一条 kind=step 的 stepIndex，无则省略 */
    lastToolStepIndex?: number;
    /** 与 failureReason 一致的简述，便于 meta 自描述 */
    errorBrief?: string;
}
/**
 * 单个步骤的状态枚举
 */
export type PlanStepStatus = 

    | "pending"  // 待执行（初始状态）
    | "running"  // 正在运行（Executor 锁定中）
    | "done"     // 已成功完成

    | "skipped"; // 被跳过（通常由 Reviewer 或用户手动干预）

/**
 * 计划中的单条任务步骤
 */
export interface PlanStep {
    index: number;         // 步骤序号（通常从 0 或 1 开始）
    title: string;         // 步骤标题（如：“搜索相关技术文档”）
    intent: string;        // 详细意图（告知 Executor 具体要做什么、达到什么目标）
    risk?: "low" | "medium" | "high"; // 风险评估（高风险操作可能触发强制人工确认）
    allowedTools?: string[]; // 权限控制：限制此步骤只能调用哪些工具（如：["google_search"]）
    status?: PlanStepStatus; // 当前步骤的实时状态
}

/**
 * 完整的任务计划对象
 */
export interface TaskPlan {
    version: 1;            // 协议版本号（方便后续向下兼容升级）
    steps: PlanStep[];     // 步骤序列
    plannerNote?: string;  // 规划者的补充说明（如：整体策略、避坑指南）
    createdAt: string;     // 创建时间戳（用于时序追踪）
}

/**
 * 审核者的结论（Reviewer 输出）
 */
export interface ReviewVerdict {
    outcome: "pass" | "fail"; // 审核结论：通过还是失败
    summary: string;          // 总结性评价
    findings: string[];       // 发现的具体问题（如：["输出格式不符合预期", "逻辑有漏洞"]）
    reviewedAt: string;       // 审核时间戳
    resumeFromStepIndex?: number; // 关键字段：如果失败，建议从哪一步（Index）开始重试或回溯
}

/**
 * 类型守卫（Type Guard）：验证对象是否符合 TaskPlan 接口
 * 在从外部输入（如 LLM 输出或数据库读取）解析 JSON 时使用，确保类型安全
 */
export function isTaskPlan(v: unknown): v is TaskPlan {
    if (!v || typeof v !== "object") return false;
    const o = v as TaskPlan;
    // 校验必要的核心字段是否存在且类型正确
    return o.version === 1 && Array.isArray(o.steps) && typeof o.createdAt === "string";
}

/**
 * 类型守卫：验证对象是否符合 ReviewVerdict 接口
 */
export function isReviewVerdict(v: unknown): v is ReviewVerdict {
    if (!v || typeof v !== "object") return false;
    const o = v as ReviewVerdict;
    return (
        (o.outcome === "pass" || o.outcome === "fail") &&
        typeof o.summary === "string" &&
        Array.isArray(o.findings) &&
        typeof o.reviewedAt === "string"
    );
}
