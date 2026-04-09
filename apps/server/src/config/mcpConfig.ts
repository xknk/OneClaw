import { existsSync, readFileSync } from "node:fs";

/**
 * 单个 MCP 服务进程配置（stdio 模式）。
 * MCP (Model Context Protocol) 允许 LLM 通过统一协议调用外部能力。
 */
export type McpServerConfig = {
    id: string;               // 服务的唯一标识符
    command: string;          // 启动命令 (如 "node", "python")
    args?: string[];          // 启动参数 (如 ["server.js"])
    cwd?: string;             // 进程的工作目录
    env?: Record<string, string>; // 进程私有的环境变量
    /** 
     * 权限控制：非空时仅暴露列出的工具名。
     * 如果省略，则默认暴露该服务端提供的所有工具。
     */
    allowedToolNames?: string[];
    priority?: number;        // 优先级，用于多个服务提供同名工具时的冲突解决
};

/**
 * 类型守卫：判断输入是否为标准的键值对对象
 */
function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * 将原始的 JSON 数据解析并验证为合规的 McpServerConfig 数组
 * @param raw 原始数据（通常来自 JSON.parse）
 */
export function parseMcpServerConfigs(raw: unknown): McpServerConfig[] {
    if (!Array.isArray(raw)) return [];
    
    const out: McpServerConfig[] = [];
    for (const item of raw) {
        if (!isRecord(item)) continue;

        // 1. 提取 ID（兼容 id 或 server 字段）
        const id =
            typeof item.id === "string"
                ? item.id.trim()
                : typeof item.server === "string"
                  ? item.server.trim()
                  : "";
        
        // 2. 提取启动命令
        const command = typeof item.command === "string" ? item.command.trim() : "";
        
        // 必填项检查：没有 ID 或 Command 则跳过
        if (!id || !command) continue;

        // 3. 解析参数数组 (args)
        let args: string[] | undefined;
        if (Array.isArray(item.args)) {
            args = item.args.filter((a): a is string => typeof a === "string");
        }

        // 4. 解析环境变量 (env)
        let env: Record<string, string> | undefined;
        if (isRecord(item.env)) {
            env = {};
            for (const [k, v] of Object.entries(item.env)) {
                if (typeof v === "string") env[k] = v;
            }
            if (Object.keys(env).length === 0) env = undefined;
        }

        // 5. 解析工具白名单 (allowedToolNames)
        let allowedToolNames: string[] | undefined;
        if (Array.isArray(item.allowedToolNames)) {
            allowedToolNames = item.allowedToolNames.filter((a): a is string => typeof a === "string");
        }

        const cwd = typeof item.cwd === "string" ? item.cwd : undefined;
        const priority =
            typeof item.priority === "number" && Number.isFinite(item.priority) ? item.priority : undefined;

        out.push({
            id,
            command,
            args,
            cwd,
            env,
            allowedToolNames,
            priority,
        });
    }
    return out;
}

/**
 * 入口函数：从系统环境变量中加载 MCP 配置
 * 优先级：文件路径 > 环境变量字符串
 */
export function loadMcpServerConfigs(): McpServerConfig[] {
    // 方式 A：从指定路径的 JSON 文件读取
    const file = process.env.ONECLAW_MCP_SERVERS_FILE?.trim();
    if (file && existsSync(file)) {
        try {
            const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
            return parseMcpServerConfigs(raw);
        } catch {
            return []; // 文件解析失败返回空
        }
    }

    // 方式 B：从环境变量直接读取 JSON 字符串
    const inline = process.env.ONECLAW_MCP_SERVERS?.trim();
    if (!inline) return [];

    try {
        return parseMcpServerConfigs(JSON.parse(inline) as unknown);
    } catch {
        return [];
    }
}
