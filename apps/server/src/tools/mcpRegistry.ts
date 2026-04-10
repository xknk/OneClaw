// 导入创建 MCP 提供者的工厂函数
import { createMcpProvider } from "./providers/mcpProvider";
// 导入工具提供者的类型定义
import type { ToolProvider } from "./types";
// 导入配置加载工具及其类型，用于读取 MCP 服务器的定义（命令、参数等）
import { loadMcpServerConfigs, type McpServerConfig } from "@/config/mcpConfig";
// 导入 MCP SDK 路由客户端，负责实际与多个 MCP Server 通信
import { RoutingMcpSdkClient } from "./mcpSdkClient";

/**
 * 模块级私有变量，用于实现单例缓存
 * cachedClient: 存储已实例化的路由客户端
 * cachedConfigKey: 存储生成该客户端时对应的配置指纹，用于判断配置是否发生变化
 */
let cachedClient: RoutingMcpSdkClient | null = null;
let cachedConfigKey: string | null = null;

/**
 * 生成配置的“稳定指纹”字符串
 * 目的：通过对关键配置字段进行排序和序列化，判断当前的配置内容是否与缓存的客户端一致。
 * 即使配置对象引用变了，只要内容（id, command, args等）没变，指纹就一致。
 */
function stableConfigKey(configs: McpServerConfig[]): string {
    return JSON.stringify(
        configs.map((c) => ({
            id: c.id,
            command: c.command,
            args: c.args ?? [],
            cwd: c.cwd ?? null,
            env: c.env ?? null,
            allowedToolNames: c.allowedToolNames ?? null,
            priority: c.priority ?? null,
        }))
    );
}

/**
 * 获取共享的路由客户端实例（核心单例逻辑）
 * @param configs 当前加载的 MCP 服务器配置列表
 * @returns 返回一个新的或缓存的 RoutingMcpSdkClient 实例
 */
function getSharedRoutingClient(configs: McpServerConfig[]): RoutingMcpSdkClient {
    const key = stableConfigKey(configs);

    // 如果缓存不存在，或者当前的配置指纹与缓存的不匹配（说明配置文件被修改了）
    if (!cachedClient || cachedConfigKey !== key) {
        // 销毁旧客户端（如果需要的话，此处可添加 cleanup 逻辑）并创建新客户端
        cachedClient = new RoutingMcpSdkClient(configs);
        // 更新缓存指纹
        cachedConfigKey = key;
    }
    return cachedClient;
}

/**
 * 为工具注册表生成 MCP 提供者数组
 * 这是供外部调用的主接口。
 * 
 * 流程：
 * 1. 加载配置 -> 2. 检查是否有配置 -> 3. 获取/创建单例客户端 -> 4. 映射为 Provider 格式
 * 
 * @returns ToolProvider[] 返回可供 AI 调用的工具提供者列表
 */
export function getMcpProvidersForRegistry(): ToolProvider[] {
    // 1. 从环境变量或配置文件加载 MCP Server 配置
    const configs = loadMcpServerConfigs();

    // 2. 如果未配置任何 MCP 服务器（如未设置 ONECLAW_MCP_SERVERS），直接返回空数组
    if (configs.length === 0) return [];

    // 3. 获取单例化的路由客户端，确保所有 Provider 共享同一个连接管理器
    const client = getSharedRoutingClient(configs);

    // 4. 将每个 Server 配置转换为统一的 ToolProvider 对象
    return configs.map((c) =>
        createMcpProvider({
            server: c.id,          // 指定服务器 ID
            client,                // 共享的 SDK 客户端实例
            allowedToolNames: c.allowedToolNames ?? [], // 该服务允许暴露的工具白名单
            priority: c.priority ?? 30,                 // 优先级，默认 30
        })
    );
}

/**
 * 在通过 API 或外部编辑修改 MCP 配置文件后调用，使下次请求使用新配置并重建连接。
 */
export function invalidateMcpRoutingCache(): void {
    cachedClient = null;
    cachedConfigKey = null;
}
