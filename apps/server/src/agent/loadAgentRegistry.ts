// src/agent/agentRegistry.ts

import fs from "fs/promises";
import path from "path";
import { appConfig } from "@/config/evn";
import type { PermissionProfileId } from "@/security/policy";

/**
 * Agent 核心配置接口
 */
export interface AgentConfig {
    id: string;              // 唯一标识符，如 "daily_report"
    displayName: string;     // 展示名称，用于 UI 显示
    systemPromptPrefix?: string; // 注入给 LLM 的系统提示词（人设关键）
    /** 
     * 允许调用的内置工具列表。
     * 如果为空，通常表示不限制（拥有 main 级别的所有权限） 
     */
    builtInToolAllowlist?: string[]; 
    /** 
     * 安全策略 ID。关联到 security/policy，决定该 Agent 能访问哪些敏感数据或文件
     */
    permissionProfileId?: PermissionProfileId;
}

/**
 * Agent 绑定/触发规则
 * 决定了在什么情况下使用哪个 Agent
 */
export interface AgentBindingRule {
    channelId?: string;        // 指定频道 ID（如某个特定的群组）
    sessionKeyPrefix?: string; // 根据会话前缀绑定
    textStartsWith?: string;   // 关键词触发（如 "/report"）
    textIncludes?: string;     // 包含某些文字时触发
    agentId: string;           // 命中规则后转向的 Agent ID
}

/**
 * 外部 JSON 配置文件的结构定义
 */
export interface AgentRegistryFile {
    agents: AgentConfig[]; // Agent 配置列表
    bindings?: AgentBindingRule[]; // Agent 绑定规则列表
}

/**
 * 硬编码的默认 Agent 配置（兜底方案）
 */
const DEFAULT_AGENTS: AgentConfig[] = [
    { id: "main", displayName: "Main" }, // 通用型 Agent
    {
        id: "frontend",
        displayName: "Frontend",
        systemPromptPrefix:
            "你是资深前端工程师，熟悉 TypeScript、现代框架（React/Vue 等）、CSS、无障碍与性能。浏览**本地**目录用 list_directory（或 exec 的 dir）；**仅**对外部文档/网页用 fetch_url（http(s)）；**禁止**用 fetch_url 访问 D:\\\\ 等本地路径；REST 接口用 http_request；不要编造未经验证的 API。",
        builtInToolAllowlist: [
            "fetch_url",
            "fetch_readable",
            "fetch_feed",
            "http_request",
            "web_search",
            "dns_resolve",
            "list_directory",
            "read_file",
            "read_file_range",
            "file_hash",
            "search_files",
            "file_stat",
            "get_time",
            "json_validate",
            "apply_patch",
            "delete_file",
            "move_file",
            "copy_file",
            "make_directory",
            "create_zip",
            "extract_zip",
            "batch_file_ops",
            "git_read",
            "git_write",
            "exec",
        ],
        permissionProfileId: "webchat_default",
    },
    {
        id: "daily_report",
        displayName: "Daily Report",
        systemPromptPrefix:
            "你是日报助手。优先调用 generate_daily_report，禁止臆测不存在的记录。",
        builtInToolAllowlist: ["generate_daily_report", "read_file", "search_files", "get_time"],
        permissionProfileId: "daily_report",
    },
    {
        id: "code_review",
        displayName: "Code Review",
        systemPromptPrefix:
            "你是代码评审助手。仅阅读与评审，不做写入与命令执行。若需对照外部文档或安全公告，可使用 fetch_url。",
        builtInToolAllowlist: [
            "read_file",
            "read_file_range",
            "file_hash",
            "search_files",
            "file_stat",
            "get_time",
            "fetch_url",
            "fetch_readable",
            "fetch_feed",
            "web_search",
            "http_request",
            "list_directory",
            "json_validate",
            "dns_resolve",
            "git_read",
        ],
        permissionProfileId: "readonly",
    },
];

/**
 * 默认的触发规则（如：输入 /report 直接找日报助手）
 */
const DEFAULT_BINDINGS: AgentBindingRule[] = [
    { textStartsWith: "/fe", agentId: "frontend" },
    { textStartsWith: "/frontend", agentId: "frontend" },
    { textStartsWith: "/report", agentId: "daily_report" },
    { textStartsWith: "/daily", agentId: "daily_report" },
    { textStartsWith: "/review", agentId: "code_review" },
];

// 运行时缓存：使用 Map 提高 ID 查询效率
let cachedAgents = new Map<string, AgentConfig>(DEFAULT_AGENTS.map((a) => [a.id, a]));
let cachedBindings: AgentBindingRule[] = DEFAULT_BINDINGS;

/**
 * 获取配置文件路径
 * 默认在 workspace 的 skills/agents/agents.json
 */
export function getAgentRegistryPath(): string {
    return path.join(appConfig.skillsDir, "agents", "agents.json");
}

/**
 * Agent 配置清洗函数
 * 确保外部输入的 JSON 数据符合 AgentConfig 格式并剔除脏数据
 */
function normalizeAgents(raw: unknown): AgentConfig[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((x): x is AgentConfig => !!x && typeof x === "object" && typeof (x as AgentConfig).id === "string")
        .map((a) => ({
            id: a.id.trim(), // 唯一标识符
            displayName: a.displayName?.trim() || a.id.trim(), // 展示名称
            systemPromptPrefix: a.systemPromptPrefix?.trim() || undefined, // 系统提示词前缀
            builtInToolAllowlist:  // 允许调用的内置工具列表
                Array.isArray(a.builtInToolAllowlist) && a.builtInToolAllowlist.length > 0 
                    ? a.builtInToolAllowlist.filter((n) => typeof n === "string") 
                    : undefined, // 如果没有内置工具列表，则返回 undefined
            permissionProfileId: a.permissionProfileId, // 安全策略 ID
        }))
        .filter((a) => a.id.length > 0);
}

/**
 * 绑定规则清洗函数
 */
function normalizeBindings(raw: unknown): AgentBindingRule[] {
    if (!Array.isArray(raw)) return []; // 判断是否是数组
    return raw
        .filter( // 过滤掉非 AgentBindingRule 类型的元素
            (x): x is AgentBindingRule =>
                !!x && // 判断是否是对象
                typeof x === "object" && // 判断是否是对象
                typeof (x as AgentBindingRule).agentId === "string" // 判断是否是字符串
        )
        .map((b) => ({
            channelId: typeof b.channelId === "string" ? b.channelId.trim() : undefined, // 频道 ID
            sessionKeyPrefix:
                typeof b.sessionKeyPrefix === "string" ? b.sessionKeyPrefix.trim() : undefined, // 会话前缀
            textStartsWith:
                typeof b.textStartsWith === "string" ? b.textStartsWith.trim() : undefined, // 文本前缀
            textIncludes: typeof b.textIncludes === "string" ? b.textIncludes.trim() : undefined, // 文本包含
            agentId: b.agentId.trim(), // 命中规则后转向的 Agent ID
        }))
        .filter((b) => b.agentId.length > 0); // 过滤掉 agentId 为空字符串的元素
}

/**
 * [核心方法] 从工作区加载并合并配置
 * 逻辑：读取文件 -> 解析 JSON -> 过滤校验 -> 与默认配置合并（文件配置覆盖默认）
 */
export async function loadAgentRegistryFromWorkspace(): Promise<void> {
    const p = getAgentRegistryPath();
    try {
        const text = await fs.readFile(p, "utf-8"); // 读取文件内容
        const json = JSON.parse(text) as AgentRegistryFile; // 解析 JSON

        const agents = normalizeAgents(json.agents); // 清洗 Agent 配置
        const bindings = normalizeBindings(json.bindings); // 清洗 Agent 绑定规则

        // 合并策略：如果 ID 冲突，用配置文件里的覆盖代码里的默认值
        const merged = [...DEFAULT_AGENTS];
        for (const a of agents) {
            const idx = merged.findIndex((m) => m.id === a.id); // 找到 ID 相同的元素
            if (idx >= 0) merged[idx] = { ...merged[idx], ...a };
            else merged.push(a); // 如果 ID 不相同，则添加到 merged 数组中
        }

        cachedAgents = new Map(merged.map((a) => [a.id, a])); // 更新 cachedAgents
        cachedBindings = bindings.length > 0 ? bindings : DEFAULT_BINDINGS; // 更新 cachedBindings
    } catch {
        // 如果文件不存在或格式错误，回退到系统默认配置
        cachedAgents = new Map(DEFAULT_AGENTS.map((a) => [a.id, a])); // 更新 cachedAgents
        cachedBindings = DEFAULT_BINDINGS; // 更新 cachedBindings
    }
}

/**
 * 根据 ID 获取 Agent 详细配置
 */
export function getAgentConfigById(agentId: string): AgentConfig | undefined {
    return cachedAgents.get(agentId); // 获取 Agent 配置
}

/**
 * 获取所有已注册的 Agent
 */
export function getAllAgentConfigs(): AgentConfig[] {
    return [...cachedAgents.values()]; // 获取所有 Agent 配置
}

/**
 * 获取所有的 Agent 匹配/绑定规则
 * 通常给路由模块使用，用来决定当前对话该分发给谁
 */
export function getAgentBindings(): AgentBindingRule[] {
    return cachedBindings; // 获取所有 Agent 绑定规则
}
