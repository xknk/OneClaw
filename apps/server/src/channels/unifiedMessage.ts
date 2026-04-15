/**
 * 【标准化消息定义层】
 * 目的：解耦 渠道层 (Channels) 与 逻辑层 (Agent/Gateway)。
 * 无论前端是 Web、APP 还是第三方平台，逻辑层只处理统一后的消息。
 */
import type { TraceDecisionSource } from "@/observability/traceTypes";
/**
 * 统一的业务意图类型
 * 用于标识用户想做什么：普通聊天、生成日报、代码评审
 */
export type UnifiedIntent = "chat" | "daily_report" | "code_review";

/**
 * 统一入站消息：从“外面”进来的消息。
 * 每一个渠道接口（如 /api/webchat）都必须先将原始 Request 转换为此模型。
 */
export interface UnifiedInboundMessage {
    /** 来源标识：如 "webchat", "discord", "wechat" */
    channelId: string;
    /** 
     * 外部用户ID：渠道方提供的唯一标识。
     * 用于追踪是哪个用户在说话，或者在多租户场景下区分用户。
     */
    channelUserId?: string;
    /** 
     * 会话索引：这是定位 AI 记忆（Memory）的关键。
     * 同一个 sessionKey 会共享历史对话。
     */
    sessionKey: string;
    /** 用户发送的文本内容 */
    text: string;
    /** 消息产生的 ISO 时间戳 */
    timestamp?: string;
    /** 
     * 显式指定的 Agent ID
     * Web 端可以通过下拉框或参数直接指定由哪个 AI 助手响应 
    */
    agentId?: string;
    /** 
    * 意图标识
    * 系统可以根据该字段分发任务，与 agentId 通常是对应关系 
    */
    intent?: string;
    /** 
  * 任务关联 ID：
  * 用于 V4 版本的工作流追踪。若存在，AI 的响应会记录到该任务的生命周期中。
  */
    taskId?: string;
    /**
     * 路由/编排决策来源（可选）。未传时由服务端根据是否显式 agentId 等推断。
     */
    decisionSource?: TraceDecisionSource;
    /**
     * 为 true 时，后续路由/分类器不应覆盖用户显式的 agentId（需编排层配合）。
     */
    agentLocked?: boolean;
    /**
     * 模型类型：ollama 或 zhipu
     */
    modelType?: "ollama" | "zhipu";
}

/**
 * 统一出站消息：从“里面”发出的回复。
 * 逻辑层生成此对象后，由具体渠道各自负责如何展示给用户。
 */
export interface UnifiedOutboundMessage {
    /** AI 回复的文本内容 */
    text: string;
    /** 
     * 扩展元数据：用于存放工具调用、引用文档、情感标签等非文本信息。
     * key-value 结构，方便不同场景自定义。
     */
    metadata?: Record<string, unknown>;
}

/**
 * 【适配器函数】WebChat 请求体转换器
 * 处理逻辑：
 * 1. 验证 Body 是否合法。
 * 2. 提取 message 字段（必填）。
 * 3. 提取 sessionKey，若前端未传入则赋予默认值 "main"。
 * 
 * @param body - 原始 HTTP 请求体 (通常是 JSON)
 * @returns 转换成功返回标准消息，校验失败返回 null
 */
export function createInboundFromWebChatBody(body: unknown): UnifiedInboundMessage | null {
    // 1. 基础类型校验：确保是一个非空的 object
    if (!body || typeof body !== "object") return null;
    // 类型断言，方便后续安全取值
    const anyBody = body as {
        message?: unknown; // 消息
        sessionKey?: unknown; // 会话键
        agentId?: unknown; // 执行任务的 Agent ID   
        intent?: unknown; // 用户意图
        taskId?: unknown; //任务关联ID
        decisionSource?: unknown;
        agentLocked?: unknown;
    };

    // 2. 核心字段校验：消息内容必须是字符串
    if (typeof anyBody.message !== "string" || anyBody.message.trim() === "") {
        return null;
    }

    /**
     * 3. 会话键提取逻辑：
     * 如果前端传了非空字符串则使用前端的，否则默认归类到 "main" 会话。
     */
    const sessionKey =
        typeof anyBody.sessionKey === "string" && anyBody.sessionKey.trim() !== ""
            ? anyBody.sessionKey.trim()
            : "main";

    // 4. 提取 Agent 标识
    const agentId =
        typeof anyBody.agentId === "string" && anyBody.agentId.trim() !== ""
            ? anyBody.agentId.trim()
            : undefined;

    // 5. 提取意图标识
    const intent =
        anyBody.intent === "chat" ||
            anyBody.intent === "daily_report" ||
            anyBody.intent === "code_review"
            ? anyBody.intent
            : undefined;
    // 5. 提取任务关联ID
    const taskId =
        typeof anyBody.taskId === "string" && anyBody.taskId.trim() !== ""
            ? anyBody.taskId.trim()
            : undefined;

    const decisionSource = parseDecisionSourceFromBody(anyBody.decisionSource);
    const agentLocked = anyBody.agentLocked === true;

    // 7. 组装并返回标准结构
    return {
        channelId: "webchat",
        channelUserId: "webchat-local", // 对于简单的 Web 聊天，可使用固定 ID
        sessionKey,
        text: anyBody.message.trim(),
        timestamp: new Date().toISOString(),
        agentId,
        intent,
        taskId,
        ...(decisionSource ? { decisionSource } : {}),
        ...(agentLocked ? { agentLocked: true } : {}),
    };
}

const DECISION_SOURCE_VALUES = new Set<TraceDecisionSource>([
    "rule",
    "classifier",
    "supervisor",
    "user",
    "binding",
    "default",
    "plan_step",
]);

function parseDecisionSourceFromBody(v: unknown): TraceDecisionSource | undefined {
    if (typeof v !== "string") return undefined;
    const s = v.trim() as TraceDecisionSource;
    return DECISION_SOURCE_VALUES.has(s) ? s : undefined;
}
