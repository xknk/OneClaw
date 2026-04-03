import type { ToolSchema } from "@/llm/providers/ModelProvider";

/** 
 * 工具来源分类 
 * builtin: 系统内置插件（如网页搜索）
 * skill: 用户或开发者定义的技能脚本
 * mcp: 模型上下文协议 (Model Context Protocol) 外部扩展
 */
export type ToolSource = "builtin" | "skill" | "mcp";

/** 
 * 工具执行的风险等级
 * low: 只读操作，无副作用（如查询天气）
 * medium: 影响用户数据的操作（如发送邮件、创建日程）
 * high: 敏感或不可逆操作（如支付转账、删除数据库）
 */
export type ToolRiskLevel = "low" | "medium" | "high";

export interface RetryPolicy {
    maxRetries: number; // 重试次数（不含首轮）
    backoffMs?: number; // 每次重试前等待
}


/**
 * 工具执行时的上下文信息
 * 用于追踪请求链路、权限校验及多租户隔离
 */
export interface ToolExecutionContext {
    traceId: string;      // 链路追踪 ID，用于日志排查
    channelId: string;    // 渠道 ID（如 Web, Mobile, API）
    sessionKey: string;   // 当前会话标识
    agentId: string;      // 执行该工具的智能体实例 ID
    profileId: string;    // 当前操作的用户画像/账号 ID
    taskId?: string; // 关联任务（含 taskId 的 WebChat 等）
}

/**
 * 工具的元数据定义
 * 描述工具“是什么”以及“如何调用”
 */
export interface ToolDefinition {
    name: string;         // 工具唯一标识名
    schema: ToolSchema;   // 符合 JSON Schema 标准的参数描述，发给 LLM 参考
    source: ToolSource;   // 来源标识
    riskLevel: ToolRiskLevel; // 风险等级，前端可能据此弹出二次确认
    version?: string;     // 工具版本号
    owner?: string;       // 责任人或所属团队
    timeoutMs?: number;   // 强制执行超时时间（毫秒）
    idempotent?: boolean; // 是否幂等（多次调用结果是否一致，影响重试策略）
    retryPolicy?: RetryPolicy; // 重试策略
}

/**
 * 工具执行后的返回结果
 */
export interface ToolExecutionResult {
    ok: boolean;          // 执行是否成功
    content: string;      // 返回给 AI 的具体数据或错误描述
    errorCode?: string;   // 错误代码（如 TIMEOUT, AUTH_FAILED）
    errorMessage?: string;// 易读的错误信息
    durationMs: number;   // 实际耗时
    source?: ToolSource;  // 执行该工具的来源
    toolName: string;     // 工具名称
}

/**
 * 工具提供者接口
 * 所有的工具源（如 MCP 插件或本地函数库）都必须实现此接口
 */
export interface ToolProvider {
    id: string;           // 提供者唯一标识
    priority: number;     // 优先级：当多个 Provider 存在同名工具时，高优先级覆盖低优先级

    /** 获取该提供者下所有可用的工具列表 */
    listDefinitions(ctx: ToolExecutionContext): Promise<ToolDefinition[]>;

    /** 
     * 执行具体的工具
     * @param name 工具名
     * @param args LLM 生成的参数对象
     * @param ctx 执行上下文
     */
    execute(
        name: string,
        args: Record<string, unknown> | undefined,
        ctx: ToolExecutionContext
    ): Promise<ToolExecutionResult | null>;
}
