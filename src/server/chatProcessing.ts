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
import { evaluateToolPermission, resolveProfileId } from "@/security/policy";
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
} from "@/tools";
import { ProviderHealth } from "@/tools/providerHealth";
import { emitTrace } from "@/observability/trace";
import { getMcpProvidersForRegistry } from "@/tools/mcpRegistry";
import {
    appendTimelineNote,
    appendTimelineToolStep,
    failTask,
    getTask,
    prepareTaskForChatRound,
    type PrepareTaskForChatResult,
} from "@/tasks/taskService";
import { formatTaskContextForModel } from "@/tasks/taskContextPrompt";
import { interceptHighRiskToolForTask } from "@/tasks/taskApproval";
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
// 创建健康状态检查
const providerHealth = new ProviderHealth({
    failureThreshold: 3,
    cooldownMs: 30_000,
});

// 辅助函数：安全地追加时间轴备注
async function appendTimelineNoteSafe(taskId: string, text: string, meta?: Record<string, unknown>): Promise<void> {
    try {
        await appendTimelineNote(taskId, text, meta);
    } catch (e) {
        console.error("[tasks] appendTimelineNote failed:", e);
    }
}

/** 辅助函数：安全地追加时间轴工具步骤 */
async function appendTimelineToolStepSafe(taskId: string, input: Parameters<typeof appendTimelineToolStep>[1]): Promise<void> {
    try {
        await appendTimelineToolStep(taskId, input);
    } catch (e) { console.error("[tasks] appendTimelineToolStep failed:", e); }
}

/** 对话失败：若任务在可失败状态则 failTask，否则忽略 */
async function failTaskAfterChatError(
    taskId: string,
    err: unknown,
    traceId: string
): Promise<void> {
    try {
        const t = await getTask(taskId);
        if (!t) return;
        if (t.status !== "running" && t.status !== "review") return;
        const msg = err instanceof Error ? err.message : String(err);
        await failTask(taskId, `chat_error: ${msg}`, {
            meta: { source: "handleUnifiedChat" },
            traceId,
        });
    } catch (e) {
        console.error("[tasks] failTaskAfterChatError:", e);
    }
}
/**
 * 统一聊天处理器（核心逻辑管道）
 * 流程：入站 -> 获取会话 -> 读取历史 -> 自动摘要/裁剪 -> 注入技能 -> 调用 Agent -> 存储回复 -> 出站回传
 */
/**
 * 统一对话处理器：系统的中枢神经
 * 处理从任何渠道进来的标准化消息，并驱动 AI 生成回复。
 */
export async function handleUnifiedChat(
    inbound: UnifiedInboundMessage,
    sendOutbound: OutboundSender
): Promise<void> {
    // --- 1. 基础上下文解析 ---
    const traceId = crypto.randomUUID(); // 全链路追踪 ID
    const userSessionKey = resolveSessionKey(inbound); // 用户会话标识
    /** 提取任务关联ID */
    const taskId =
        typeof inbound.taskId === "string" && inbound.taskId.trim() !== ""
            ? inbound.taskId.trim()
            : undefined;
    /** 有 taskId 时转录按任务隔离，避免多任务共用 main 历史 */
    const sessionKey = (taskId ? `task:${taskId}` : userSessionKey) as SessionKey;

    // 确定由哪个 AI 助手响应，并获取其特定配置
    const agentId = resolveAgentId(inbound);
    const agent = getAgentConfig(agentId);
    // 权限画像识别：基于渠道和 Agent 确定当前用户的操作权限
    const profileId = resolveProfileId({ channelId: inbound.channelId, agentId });
    const userText = normalizeTextForAgent(agentId, inbound.text);

    // --- 2. 任务状态前置准备 ---
    let taskPrep: PrepareTaskForChatResult | undefined;
    if (taskId) {
        try {
            // 调用之前定义的函数，将任务推向 running 状态或标记为 notesOnly
            taskPrep = await prepareTaskForChatRound(taskId);
        } catch (e) {
            console.error("[tasks] prepareTaskForChatRound failed:", e);
            taskPrep = undefined;
        }
    }

    // 发送链路开始追踪事件
    const traceBase = { traceId, sessionKey, agentId, channelId: inbound.channelId, profileId };
    await emitTrace(traceBase, "session.start", {
        meta: {
            textLength: userText.length,
            taskId,
            taskHooks: taskPrep?.hooksEnabled ?? false,
            userSessionKey,
            transcriptSessionKey: sessionKey,
        },
    });

    // --- 3. 记忆与上下文管理 ---
    const sessionId = await getOrCreateSessionId(sessionKey, agentId);
    const history = await readMessages(sessionId, agentId); // 从存储层读取历史
    await appendMessage(sessionId, "user", userText, agentId); // 存入本次用户输入

    const fullMessages: ChatMessage[] = [...history, { role: "user", content: userText }];

    // 上下文压缩逻辑：如果消息太多，将旧消息摘要化，只保留最近的 N 条
    const maxMessages = appConfig.chatContextMaxMessages ?? 30;
    const threshold = appConfig.chatSummarizeThreshold ?? 20;

    let messages: ChatMessage[];
    if (fullMessages.length > threshold) {
        const recentCount = maxMessages - 1;
        const oldPart = fullMessages.slice(0, -recentCount);
        const recent = fullMessages.slice(-recentCount);
        const summary = await summarizeMessages(oldPart); // 调用 LLM 生成摘要
        messages = [{ role: "system", content: `【此前对话摘要】\n${summary}` }, ...recent];
    } else {
        messages = trimMessagesToContextLimit(fullMessages, { maxMessages });
    }

    // --- 4. 技能与工具装配 ---
    const prefixBlocks: ChatMessage[] = [];

    if (agent.systemPromptPrefix) {
        prefixBlocks.push({ role: "system", content: agent.systemPromptPrefix });
    }

    // 根据当前上下文加载动态技能（例如从数据库加载的特定业务逻辑）
    const skillCtx = {
        channelId: inbound.channelId,
        sessionKey: userSessionKey,
        agentId,
        userText
    };
    const loaded = await loadSkillsForContext(skillCtx);
    const { systemPrompts, skills, toolSchemas: skillToolSchemas } = loaded;

    rebuildRuntimeSkillTools(skills); // 热更新技能工具实现
    if (systemPrompts.length > 0) {
        prefixBlocks.push({ role: "system", content: systemPrompts.join("\n\n") });
    }
    if (taskPrep?.record) {
        prefixBlocks.push({
            role: "system",
            content: formatTaskContextForModel(taskPrep.record),
        });
    }
    if (prefixBlocks.length) {
        messages = [...prefixBlocks, ...messages];
    }

    // --- 5. 工具执行服务初始化 ---
    const allow = getBuiltInToolAllowlistForAgent(agentId); // 获取该 Agent 允许使用的工具白名单
    const mcpProviders = getMcpProvidersForRegistry(); // 接入 MCP (Model Context Protocol) 外部服务

    const registry = createRegistryWithProviders([
        ...mcpProviders,
        createRuntimeSkillProvider(filterSchemasByAllowlist(skillToolSchemas, allow)),
        builtinProvider,
    ]);
    const toolExecutionCtx = {
        traceId,
        channelId: inbound.channelId,
        sessionKey,
        agentId,
        profileId,
        taskId,
    };
    const execService = new ToolExecutionService({
        registry,
        health: providerHealth, // 熔断保护逻辑
        ctx: toolExecutionCtx,
        // 【关键安全钩子】：在工具真正执行前拦截并进行权限评估
        toolGuard: (toolName, args) =>
            evaluateToolPermission({ channelId: inbound.channelId, sessionKey, agentId, profileId }, toolName, args),
        onFinished: async (event) => {
            // 工具执行完后记录详细日志
            const line = makeToolCallLog({ ...event, traceId, sessionKey, agentId });
            await appendToolCallLog(line);
            if (taskId?.trim() && taskPrep?.hooksEnabled) {
                await appendTimelineToolStepSafe(taskId, {
                    traceId,
                    toolName: event.toolName,
                    ok: event.ok,
                    durationMs: event.durationMs,
                    label: event.toolName,
                    summary: `${event.toolName} — ${event.ok ? "ok" : "失败"} (${event.durationMs}ms)`,
                    meta: {
                        agentId,
                        sessionKey,
                        channelId: inbound.channelId,
                        argsSummary: line.argsSummary,
                        resultSummary: line.resultSummary,
                        errorCode: event.errorCode,
                        attempt: event.attempt,
                        source: event.source,
                    },
                });
            }
        },
        trace: (eventType, patch) => emitTrace(
            traceBase,
            eventType as any,
            patch as any
        ),
    });

    let toolSchemas = await execService.getToolSchemas();
    toolSchemas = filterSchemasByAllowlist(toolSchemas, allow);

    // --- 6. 核心推理循环 (The Run Loop) ---
    let replyText = "";
    try {
        // 调用 Agent 引擎，它会根据 messages 和 toolSchemas 决定是说话还是调工具
        replyText = await runAgent(messages, getAllTools(), {
            toolSchemas,
            executeTool: async (toolName, args) => {
                const resolved = await registry.resolveByName(toolName, toolExecutionCtx, {
                    health: providerHealth,
                });
                const blocked = await interceptHighRiskToolForTask({
                    taskId,
                    toolName,
                    args,
                    traceId,
                    riskLevel: resolved?.definition.riskLevel,
                });
                if (blocked) return blocked;
                return execService.execute(toolName, args);
            },
            onModelEvent: (e) => emitTrace(
                traceBase,
                e.type,
                { meta: e }
            ),
        });

        // --- 7. 响应与任务反馈 ---
        await appendMessage(sessionId, "assistant", replyText, agentId); // 保存 AI 回复
        await touchSession(sessionKey, agentId); // 更新活跃时间

        // 将结果发回前端
        await sendOutbound({
            text: replyText,
            metadata: { traceId, agentId, profileId, taskId },
        });

        // 如果关联了任务，且允许更新，则在时间线上记一笔
        if (taskId && taskPrep?.hooksEnabled) {
            await appendTimelineNoteSafe(taskId, "WebChat 轮次完成", {
                traceId,
                agentId,
                channelId: inbound.channelId,
                replyLength: replyText.length,
                notesOnly: taskPrep.notesOnly
            });
        }
        await emitTrace(traceBase, "session.end", {
            ok: true,
            meta: { replyLength: replyText.length, taskId, userSessionKey, transcriptSessionKey: sessionKey },
        });
    } catch (err) {
        // 错误处理：记录日志并尝试更新任务为失败状态
        console.error("[handleUnifiedChat] Error:", err);
        await emitTrace(traceBase, "session.end", {
            ok: false,
            meta: {
                taskId,
                userSessionKey,
                transcriptSessionKey: sessionKey,
                error: err instanceof Error ? err.message : String(err),
            },
        });
        if (taskId && taskPrep?.hooksEnabled) {
            if (taskPrep.notesOnly) {
                await appendTimelineNoteSafe(taskId, "WebChat 轮次失败（未更改任务主状态）", {
                    traceId,
                    agentId,
                    error: err instanceof Error ? err.message : String(err),
                });
            } else {
                await failTaskAfterChatError(taskId, err, traceId);
            }
        }
        throw err;
    }
}
