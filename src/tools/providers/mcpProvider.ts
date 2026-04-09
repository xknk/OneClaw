import { logErrorUnlessTui } from "@/infra/tuiLog";
import type {
    ToolDefinition,
    ToolExecutionContext,
    ToolExecutionResult,
    ToolProvider
} from "../types";

/**
 * MCP 工具的描述信息，对应 MCP 协议中的工具元数据
 */
export interface McpToolDescriptor {
    name: string;          // 工具唯一标识名
    description?: string;   // 帮助 AI 理解何时使用该工具的描述
    parameters?: Record<string, unknown>; // 参数的 JSON Schema 定义
    riskLevel?: "low" | "medium" | "high"; // 风险等级，用于触发人工授权
}

/**
 * MCP 客户端最小接口实现
 * 负责与底层的 MCP Server（如通过 stdio 或 SSE）进行通信
 */
export interface McpClient {
    // 获取服务器上所有可用的工具列表
    listTools(server: string): Promise<McpToolDescriptor[]>;
    // 调用指定工具并获取返回结果（通常为字符串或 JSON）
    callTool(server: string, toolName: string, args: Record<string, unknown> | undefined): Promise<string>;
}

/**
 * 创建 MCP Provider 时的配置项
 */
export interface McpProviderOptions {
    server: string;           // MCP 服务器标识（如 "mysql-server"）
    client: McpClient;         // 具体的客户端实例
    priority?: number;         // 优先级：当多个工具同名时，决定使用哪一个
    allowedToolNames?: string[]; // 白名单：出于安全考虑，仅允许暴露的工具列表
}

/**
 * 工厂函数：将一个 MCP Server 封装为系统可用的 ToolProvider
 */
export function createMcpProvider(opts: McpProviderOptions): ToolProvider {
    // 使用 Set 优化白名单查询性能
    const allow = new Set(opts.allowedToolNames ?? []);

    return {
        // 唯一标识符，格式通常为 mcp:server_name
        id: `mcp:${opts.server}`,
        // 默认优先级 30，通常介于内置工具(50+)和插件工具(10+)之间
        priority: opts.priority ?? 30,

        /**
         * 将 MCP 的工具格式转换为框架通用的 ToolDefinition 格式
         */
        async listDefinitions(_ctx: ToolExecutionContext): Promise<ToolDefinition[]> {
            try {
                const tools = await opts.client.listTools(opts.server);
                return tools
                .filter((t) => allow.size === 0 || allow.has(t.name)) // 过滤掉不在白名单中的工具
                .map((t) => ({
                    name: t.name,
                    schema: {
                        name: t.name,
                        description: t.description ?? `来自 ${opts.server} 的 MCP 工具`,
                        // 确保参数符合 JSON Schema 对象格式，MCP 默认通常就是对象
                        parameters: (t.parameters as any) ?? { type: "object" },
                    },
                    source: "mcp",           // 标记来源为 MCP
                    riskLevel: t.riskLevel ?? "low",
                    timeoutMs: 15_000,       // 设置 15 秒超时防止卡死
                    retryPolicy: { maxRetries: 0, backoffMs: 0 }, // MCP 调用通常不建议自动重试，交由上层处理
                    idempotent: true,        // 假设 MCP 工具是幂等的，视具体情况调整
                    version: "1",
                    owner: `mcp:${opts.server}`,
                }));
            } catch (err) {
                logErrorUnlessTui(
                    `[oneclaw] MCP listTools 失败，已跳过服务 ${opts.server}:`,
                    err instanceof Error ? err.message : String(err)
                );
                return [];
            }

            
        },

        /**
         * 执行具体的工具调用
         */
        async execute(
            name: string,
            args: Record<string, unknown> | undefined,
            _ctx: ToolExecutionContext
        ): Promise<ToolExecutionResult | null> {
            // 运行时二次安全检查：如果不在白名单则拒绝执行
            if (allow.size > 0 && !allow.has(name)) return null;

            const started = Date.now();
            try {
                // 透传调用到 MCP Client
                const content = await opts.client.callTool(opts.server, name, args);

                return {
                    ok: true,
                    content,
                    durationMs: Date.now() - started, // 记录耗时用于性能分析
                    source: "mcp",
                    toolName: name,
                };
            } catch (err) {
                // 捕获错误并转换为框架统一的错误格式
                return {
                    ok: false,
                    content: `MCP 工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
                    errorCode: "TOOL_EXEC_ERROR",
                    errorMessage: err instanceof Error ? err.message : String(err),
                    durationMs: Date.now() - started,
                    source: "mcp",
                    toolName: name,
                };
            }
        },
    };
}
