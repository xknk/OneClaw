import crypto from "node:crypto"
import { runAgent } from "@/agent/runAgent";
import { getAllTools } from "@/agent/tools";
import { UnifiedInboundMessage, UnifiedOutboundMessage } from "@/channels/unifiedMessage";
import { appConfig } from "@/config/evn";
import { ChatMessage } from "@/llm/model";
import { trimMessagesToContextLimit } from "@/session/contextLimit";
import { getOrCreateSessionId, touchSession } from "@/session/store";
import { summarizeMessages } from "@/session/summarizeContext";
import { appendMessage, readMessages } from "@/session/transcript";
import { SessionKey } from "@/session/type";
import { loadSkillsForContext } from "@/skills/loadSkills";
import { checkToolPermission, resolveProfileId } from "@/security/policy";
import { appendToolCallLog, makeToolCallLog } from "@/agent/toolCallLog";
import {
    getAgentConfig,
    resolveAgentId,
    normalizeTextForAgent,
    getBuiltInToolAllowlistForAgent
} from "@/agent/agentRegistry";
import { rebuildRuntimeSkillTools } from "@/skills/toolImplRegistry";
import {
    createRegistryWithProviders,
    ToolExecutionService,
    builtinProvider,
    createRuntimeSkillProvider,
    type ToolDefinition,
} from "@/tools";

import { ProviderHealth } from "@/tools/providerHealth";
import { createMcpProvider } from "@/tools/providers/mcpProvider";
import { mcpClientStub } from "@/tools/mcpClient";

/** 
 * 定义出站发送函数的类型签名
 * 不同的渠道（Web/QQ）会传入不同的实现来完成消息回传
 */
type OutboundSender = (outbound: UnifiedOutboundMessage) => Promise<void>;
export const DEFAULT_SESSION_KEY: SessionKey = "main";
/**
 * 辅助函数：从统一消息体中提取会话标识
 * 用于区分不同用户的聊天上下文
 */
function resolveSessionKey(inbound: UnifiedInboundMessage): SessionKey {
    return (inbound.sessionKey ?? DEFAULT_SESSION_KEY) as SessionKey;
}

/**
 * 辅助函数：根据白名单过滤工具 Schema
 * @param items 待过滤的工具列表
 * @param allow 允许的工具名集合（Set）。如果为 null，则表示不限制，允许全部。
 */
function filterSchemasByAllowlist<T extends { name: string }>(items: T[], allow: Set<string> | null): T[] {
    if (!allow) return items;
    return items.filter((x) => allow.has(x.name));
}

/**
 * 统一聊天处理器（核心逻辑管道）
 * 流程：入站 -> 获取会话 -> 读取历史 -> 自动摘要/裁剪 -> 注入技能 -> 调用 Agent -> 存储回复 -> 出站回传
 */
export async function handleUnifiedChat(
    inbound: UnifiedInboundMessage, // 入站消息
    sendOutbound: OutboundSender // 出站发送函数
): Promise<void> {
    // 返回sessionKey和userText
    const sessionKey = resolveSessionKey(inbound); // 会话键
    const traceId = crypto.randomUUID(); // 生成本次请求的追踪 ID

    // 1. 环境上下文解析
    // 获取执行任务的 Agent ID
    const agentId = resolveAgentId(inbound);
    // 获取 Agent 配置
    const agent = getAgentConfig(agentId);
    // 获取权限配置 ID
    const profileId = resolveProfileId({ channelId: inbound.channelId, agentId });
    // 标准化用户输入的文本内容
    const userText = normalizeTextForAgent(agentId, inbound.text);

    /**
     * 2. 构造技能运行上下文
     * 这是“按需加载”的核心。它将决定哪些技能 JSON 会被激活
     */
    const skillCtx = {
        channelId: inbound.channelId,
        sessionKey,
        agentId,
        userText,
    };

    // 3. 获取会话 ID 并持久化用户输入
    const sessionId = await getOrCreateSessionId(sessionKey, agentId);
    const history = await readMessages(sessionId, agentId);
    await appendMessage(sessionId, "user", userText, agentId);

    // 4. 构造当前完整对话流
    const fullMessages: ChatMessage[] = [
        ...history,
        { role: "user", content: userText },
    ];

    // 5. 上下文长度管理（防止超过大模型 Token 限制）
    const maxMessages = appConfig.chatContextMaxMessages ?? 30;
    const threshold = appConfig.chatSummarizeThreshold ?? 20;

    let messages: ChatMessage[];
    if (fullMessages.length > threshold) {
        // 如果对话过长，保留最近的 N 条，剩下的部分进行 AI 自动摘要总结
        const recentCount = maxMessages - 1;
        const oldPart = fullMessages.slice(0, -recentCount);
        const recent = fullMessages.slice(-recentCount);
        const summary = await summarizeMessages(oldPart);
        messages = [
            { role: "system", content: `【此前对话摘要】\n${summary}` },
            ...recent,
        ];
    } else {
        // 简单裁剪到最大允许数量
        messages = trimMessagesToContextLimit(fullMessages, { maxMessages });
    }

    // 6. 提示词增强（Skills & System Prompt）
    const prefixBlocks: ChatMessage[] = [];
    // 注入 Agent 基础配置中的 System Prompt
    if (agent.systemPromptPrefix) {
        prefixBlocks.push({ role: "system", content: agent.systemPromptPrefix });
    }


    // 7. 技能（System Prompt）注入

    // 从 Workspace 动态加载自定义的系统提示词，决定 AI 的身份和能力边界
    const loaded = await loadSkillsForContext(skillCtx);
    const { systemPrompts, skills, toolSchemas: skillToolSchemas } = loaded;
    rebuildRuntimeSkillTools(skills);
    if (systemPrompts.length > 0) {
        prefixBlocks.push({ role: "system", content: systemPrompts.join("\n\n") });
    }

    if (prefixBlocks.length) {
        messages = [...prefixBlocks, ...messages];
    }

    // Agent allowlist（模型可见 + 执行都要生效）
    const allow = getBuiltInToolAllowlistForAgent(agentId);

    // 创建健康状态检查
    const providerHealth = new ProviderHealth({
        failureThreshold: 3,
        cooldownMs: 30_000,
    });
    // 创建 MCP 工具提供者
    const mcpProvider = createMcpProvider({
        server: "user-fetch",
        client: mcpClientStub,
        allowedToolNames: [], // 先空 or 指定只读工具
    });
    // 创建工具注册表
    const registry = createRegistryWithProviders([
        createRuntimeSkillProvider(filterSchemasByAllowlist(skillToolSchemas, allow)),
        builtinProvider,
    ]);
    // 创建工具执行服务
    const execService = new ToolExecutionService({
        registry, // 工具注册表
        health: providerHealth, // 健康状态检查
        ctx: { // 当前执行的上下文（用户、会话等）
            traceId, // 追踪 ID
            channelId: inbound.channelId, // 渠道标识
            sessionKey, // 会话标识
            agentId, // 执行任务的 Agent ID
            profileId, // 权限配置 ID
        },
        toolGuard: (toolName, args) => // 工具守卫（拦截器）
            checkToolPermission( // 检查工具权限
                {
                    channelId: inbound.channelId, // 渠道标识
                    sessionKey, // 会话标识
                    agentId, // 执行任务的 Agent ID
                    profileId, // 权限配置 ID
                },
                toolName, // 工具名称
                args, // 工具入参
            ),
        onFinished: async (event) => { // 工具执行完成后触发
            const line = makeToolCallLog({
                traceId, // 追踪 ID
                sessionKey, // 会话标识
                agentId, // 执行任务的 Agent ID
                toolName: event.toolName, // 工具名称
                args: event.args, // 工具入参
                result: event.result, // 工具执行结果
                ok: event.ok, // 工具执行是否成功
                durationMs: event.durationMs, // 工具执行耗时
            });
            await appendToolCallLog(line); // 将工具执行日志写入 JSONL 文件
        },
    });

    // 统一从执行服务拿 schemas，再给 runAgent（定义与执行彻底同源）
    let toolSchemas = await execService.getToolSchemas();
    toolSchemas = filterSchemasByAllowlist(toolSchemas, allow);


    // 执行工具
    const replyText = await runAgent(messages, getAllTools(),
        {
            toolSchemas, // 工具元数据
            executeTool: (toolName, args) => execService.execute(toolName, args), // 执行工具
        }); // 执行 Agent

    // 5. 结果持久化并更新会话活跃状态
    await appendMessage(sessionId, "assistant", replyText, agentId);
    // 更新会话活跃状态
    await touchSession(sessionKey, agentId);
    // 6. 将结果通过回调发回给对应的渠道（Web/API等）
    await sendOutbound({
        text: replyText,
        metadata: { traceId, agentId, profileId },
    });
}