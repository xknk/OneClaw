import { appConfig } from "@/config/evn";
import { logErrorUnlessTui } from "@/infra/tuiLog";
import type { McpClient, McpToolDescriptor } from "./providers/mcpProvider";
import type { McpServerConfig } from "@/config/mcpConfig";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * 辅助函数：将 MCP 服务返回的复杂结果对象格式化为字符串
 * LLM 最终需要看到的是纯文本或 JSON 字符串
 */
function contentBlocksToStrings(content: unknown): string[] {
    if (!Array.isArray(content)) return [];
    return content.map((c) => {
        if (
            c &&
            typeof c === "object" &&
            "type" in c &&
            c.type === "text" &&
            "text" in c &&
            typeof (c as { text: unknown }).text === "string"
        ) {
            return (c as { text: string }).text;
        }
        return JSON.stringify(c);
    });
}

/**
 * 辅助函数：将 MCP 服务返回的复杂结果对象格式化为字符串
 * LLM 最终需要看到的是纯文本或 JSON 字符串
 */
function formatCallToolResult(result: CompatibilityCallToolResult): string {
    /**
     * 兼容旧版："toolResult" 字段直接返回字符串
     */
    if ("toolResult" in result) {
        const tr = result.toolResult;
        return typeof tr === "string" ? tr : JSON.stringify(tr);
    }
    /**
     * 错误情况：返回内容摘要
     */
    if (result.isError) {
        const parts = contentBlocksToStrings(result.content);
        return parts.length ? `MCP 工具报错: ${parts.join("\n")}` : "MCP 工具报错";
    }
    /**
     * 结构化内容：返回 JSON 字符串
     */
    if (result.structuredContent !== undefined && result.structuredContent !== null) {
        return typeof result.structuredContent === "string"
            ? result.structuredContent
            : JSON.stringify(result.structuredContent);
    }

    return contentBlocksToStrings(result.content).join("\n");
}

/** process.env 值为 string | undefined；StdioClientTransport.env 要求 Record<string, string> */
function mergeProcessEnvWith(override: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) out[k] = v;
    }
    Object.assign(out, override);
    return out;
}
/**
 * RoutingMcpSdkClient：按 ID 路由的 MCP SDK 客户端
 * 核心逻辑：为每个配置的 Server ID 维护一个独立的连接池（Map 缓存）
 */
export class RoutingMcpSdkClient implements McpClient {
    // 存储配置信息：ID -> 配置
    private readonly byId = new Map<string, McpServerConfig>();
    // 存储活跃的连接会话：ID -> 正在连接或已连接的 Client Promise
    private readonly clients = new Map<string, Promise<Client>>();

    constructor(configs: McpServerConfig[]) {
        for (const c of configs) {
            this.byId.set(c.id, c);
        }
    }

    /**
     * 获取指定服务器支持的所有工具列表
     */
    async listTools(server: string): Promise<McpToolDescriptor[]> {
        const ms = Math.max(1000, appConfig.mcpListToolsTimeoutMs); // 10秒

        const work = this.withClient(server, async (client) => {
            const r = await client.listTools(); // 获取工具列表
            return r.tools.map((t) => ({ // 转换为工具描述对象
                name: t.name, // 工具名
                description: t.description, // 工具描述
                parameters: (t.inputSchema as Record<string, unknown> | undefined) ?? { type: "object" }, // 工具参数
            }));
        });
        // 设置超时时间
        const deadline = new Promise<never>((_, reject) => {
            setTimeout(() => {
                logErrorUnlessTui(`MCP listTools 超时（>${ms}ms，server=${server}）`);
                reject(new Error(`MCP listTools 超时（>${ms}ms，server=${server}）`));
            }, ms);
        });
        // 竞争获取结果
        try {
            return await Promise.race([work, deadline]);
        } catch (e) {
            this.clients.delete(server);
            throw e;
        }
    }

    /**
     * 调用特定服务器上的工具
     */
    async callTool(
        server: string,
        toolName: string,
        args: Record<string, unknown> | undefined
    ): Promise<string> {
        return this.withClient(server, async (client) => {
            const result = await client.callTool({
                name: toolName,
                arguments: args ?? {},
            });
            return formatCallToolResult(result); // 格式化后返回给 Agent
        });
    }

    /**
     * 高阶包装函数：确保在执行操作前已连接，并处理执行过程中的异常
     */
    private async withClient<T>(server: string, fn: (c: Client) => Promise<T>): Promise<T> {
        try {
            const client = await this.connect(server);
            return await fn(client);
        } catch (e) {
            // 如果执行失败（如进程崩溃），从缓存中删除该客户端，下次调用时触发重连
            this.clients.delete(server);
            throw e;
        }
    }

    /**
     * 连接管理逻辑：实现懒加载和连接复用
     */
    private async connect(server: string): Promise<Client> {
        // 1. 检查是否已有缓存的连接（或正在进行的连接）
        const existing = this.clients.get(server);
        if (existing) {
            try {
                return await existing;
            } catch {
                // 如果之前的连接尝试失败了，清除缓存以便重试
                this.clients.delete(server);
            }
        }

        // 2. 获取配置
        const cfg = this.byId.get(server);
        if (!cfg) {
            throw new Error(`未配置的 MCP 服务器 id: ${server}`);
        }

        // 3. 创建新的 Stdio 连接进程
        const pending = (async () => {
            const client = new Client({ name: "oneclaw", version: "0.1.0" });
            const transport = new StdioClientTransport({
                command: cfg.command,   // 如 "python"
                args: cfg.args ?? [],   // 如 ["my_tool.py"]
                cwd: cfg.cwd,
                // 注入环境变量，同时保留当前系统的环境变量
                env: cfg.env ? mergeProcessEnvWith(cfg.env) : undefined,
                stderr: "pipe",         // 捕获错误输出
            });
            await client.connect(transport);
            return client;
        })();

        // 4. 将 Promise 存入缓存（防止同一时间多次触发进程启动）
        this.clients.set(server, pending);
        try {
            return await pending;
        } catch (e) {
            this.clients.delete(server);
            throw e;
        }
    }
}
