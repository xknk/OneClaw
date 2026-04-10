/**
 * 路由/编排决策来源（多 Agent、意图分类、Supervisor 等与 trace 对齐）
 */
export type TraceDecisionSource =
    | "rule"
    | "classifier"
    | "supervisor"
    | "user"
    | "binding"
    | "default"
    /** 任务计划当前 running 步的 assignedAgentId */
    | "plan_step";

/**
 * 协作中的角色（与任务 PlanStep.role、trace 对齐；可扩展自定义字符串）
 */
export type TraceOrchestrationRole =
    | "planner"
    | "worker"
    | "reviewer"
    | "supervisor";

/**
 * 追踪事件类型
 * 定义了 AI Agent 生命周期中的关键观测点
 */
export type TraceEventType =

    | "session.start"           // 会话开始：用户发起请求，系统初始化
    | "session.end"             // 会话结束：响应完全结束或连接断开
    | "llm.request"             // LLM 请求：准备向大模型发送 Prompt
    | "llm.response"            // LLM 响应：收到大模型的回复（含 Token 消耗等）
    | "llm.error"               // LLM 调用失败：网络/模型/配置等导致本轮推理未返回
    | "tool.resolve"            // 工具解析：系统识别出需要调用哪个插件/工具
    | "tool.execute.start"      // 工具执行开始：具体的函数或 API 开始运行
    | "tool.execute.end"        // 工具执行结束：拿到工具返回的结果
    | "tool.denied"             // 工具拒绝：可能触发了安全策略或用户手动拒绝执行
    | "tool.validation.failed" // 校验失败：工具入参不符合定义（Schema 校验失败）
    | "tool.failed";             // 工具执行失败：工具执行过程中发生错误
/**
 * 追踪事件对象接口
 * 用于结构化日志存储、性能分析及错误排查
 */
export interface TraceEvent {
    /** 唯一的追踪 ID，用于串联单次任务的所有相关事件 */
    traceId: string;

    /** 事件发生的时间戳，建议使用 ISO 8601 格式（如：2023-10-27T10:00:00Z） */
    timestamp: string;

    /** 事件的具体类型 */
    eventType: TraceEventType;

    // --- 业务上下文标识 ---
    /** 关联的会话 Key */
    sessionKey?: string;
    /** 执行任务的 Agent 机器人 ID */
    agentId?: string;
    /** 渠道 ID（如：Web, App, Slack 等） */
    channelId?: string;
    /** 最终用户 ID */
    profileId?: string;

    // --- 多 Agent / 编排（可选；用于串联 Supervisor、分步任务、审计）---
    /** 一次编排实例 ID，任务场景可与 taskId 一致 */
    orchestrationId?: string;
    /** 当前计划步骤序号（与 TaskPlan.steps[].index 对齐） */
    stepIndex?: number;
    /** 当前步骤承担的角色 */
    orchestrationRole?: TraceOrchestrationRole | string;
    /** 本次生效 Agent 的路由/编排决策来源 */
    decisionSource?: TraceDecisionSource;

    // --- 工具调用相关字段 (仅在 tool.* 相关事件中存在) ---
    /** 工具的名称，如 "get_weather" */
    toolName?: string;
    /** 工具来源：内置、自定义技能、MCP 协议、策略控制、注册中心或防护网 */
    toolSource?: "builtin" | "skill" | "mcp" | "policy" | "registry" | "guard";

    // --- 执行结果与性能 ---
    /** 执行是否成功 */
    ok?: boolean;
    /** 该步骤消耗的时长（毫秒） */
    durationMs?: number;
    /** 错误码，当 ok 为 false 时必填 */
    errorCode?: string;
    /** 重试次数（针对 LLM 或工具调用失败后的自动重试） */
    attempt?: number;

    /** 
     * 扩展字段
     * 用于存储不固定的轻量元数据，避免直接将巨大的 Request/Response Payload 塞入
     * 例如：存储命中的版本号、关键标签等
     */
    meta?: Record<string, unknown>;
}
