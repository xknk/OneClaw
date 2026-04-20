/**
 * 智能上下文组装工具 (Cache 优化生产版)
 * 核心：逻辑滑动窗口、摘要后置、断路器保护、工具消息折叠
 */

import type { ChatMessage } from "@/llm/providers/ModelProvider";
import { appConfig } from "@/config/evn";
import {
    estimateMessagesTokens,
    trimMessagesToTokenBudget,
    estimateTextTokens,
} from "@/session/contextLimit";
import { mergeRollingSummary } from "@/session/summarizeContext";
import type { RollingState } from "@/session/store";

// --- 【配置常量】 ---
const MAX_CONSECUTIVE_FAILURES = 3;
const {
    chatHistoryMaxTokens: MAX_HIST,
    chatSingleMessageMaxTokens: SINGLE_MAX,
    chatContextReserveMessages: MIN_RESERVE,
    chatContextMaxMessages: MAX_MSG_COUNT
} = appConfig;

export type BuildModelContextResult = {
    messages: ChatMessage[];
    rolling: RollingState;
};

/**
 * 【辅助工具】微缩清理内容
 */
function microcompactMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => ({
        ...msg,
        content: (msg.content || "").replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{3,}/g, ' ').trim()
    }));
}

/**
 * 【辅助工具】Cache 友好型消息清理
 * 不使用 filter，而是将过时的工具消息内容置空，保持数组索引和长度稳定以利于 Cache
 */
/**
 * 【关键：同步折叠工具消息】
 * 逻辑：保留最近 N 个工具的完整细节，将更旧的工具结果及其请求参数同步折叠。
 * 作用：极大地节省 Token，同时保持 Assistant 和 Tool 消息的配对完整性。
 */
function foldObsoleteToolMessages(messages: ChatMessage[], keepLastN = 3): ChatMessage[] {
    const result = [...messages];
    let toolResultCount = 0;

    // --- 第一步：逆序扫描，确定需要折叠的 Tool Call ID ---
    const idsToFold = new Set<string>();

    for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i];
        // 匹配工具响应消息
        if (msg.role === 'tool') {
            toolResultCount++;
            // 只有超过 keepLastN 的旧消息才进入折叠流程
            if (toolResultCount > keepLastN) {
                const callId = (msg as any).tool_call_id;
                if (callId) idsToFold.add(callId);

                // 折叠 Tool 消息内容：增加语义提示，防止模型对空内容产生幻觉
                const originalLength = msg.content?.length || 0;
                result[i] = {
                    ...msg,
                    content: `[Historical Tool Data Folded: ${originalLength} chars of output. Details are archived.]`
                };
            }
        }
    }

    // --- 第二步：再次扫描，同步折叠 Assistant 消息中的请求参数 ---
    for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i];
        // 匹配包含工具调用的助手消息
        if (msg.role === 'assistant' && (msg as any).tool_calls) {
            const calls = (msg as any).tool_calls as any[];

            // 只要该消息中包含任何一个需要折叠的 ID，就进行处理
            const hasTargetId = calls.some(tc => idsToFold.has(tc.id));

            if (hasTargetId) {
                result[i] = {
                    ...msg,
                    tool_calls: calls.map(tc => {
                        if (tc.id && idsToFold.has(tc.id)) {
                            // 兼容两种常见形状：
                            // 1) OpenAI: { id, type:"function", function:{ name, arguments } }
                            // 2) 业务层: { id, name, args }
                            const hasFunctionShape = tc.function && typeof tc.function === "object";
                            return {
                                ...tc,
                                ...(hasFunctionShape
                                    ? {
                                          function: {
                                              ...tc.function,
                                              arguments: "{}",
                                          },
                                      }
                                    : {
                                          args: {},
                                      }),
                            };
                        }
                        return tc;
                    })
                };
            }
        }
    }

    return result;
}




/**
 * 【关键：Cache 友好组装器】
 * 结构：[人设] -> [活跃对话序列] -> [历史摘要]
 */
function assembleFinalSequence(summary: string, workingMsgs: ChatMessage[]): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    // 1. 绝对固定的人设 (Cache 起点)
    msgs.push({ role: "system", content: "你是一个专业的助手。" });

    // 2. 原始对话流 (只要不被摘要切断，前缀持续匹配)
    msgs.push(...workingMsgs);

    // 3. 摘要后置：变动的内容放在末尾，不破坏前面的 Cache Hash
    if (summary.trim()) {
        msgs.push({
            role: "system",
            content: `[Historical Context Summary]\n${summary.trim()}\n请参考上述背景回答。`
        });
    }
    return msgs;
}

export async function buildMessagesForModel(
    fullMessages: ChatMessage[],
    rolling: RollingState
): Promise<BuildModelContextResult> {
    // 1. 状态校验与初始化
    let { rollingSummary, archivedMessageCount = 0, consecutiveFailures = 0 } = rolling;

    // 逻辑截取：不再寻找 Boundary 字符，而是直接利用 archivedMessageCount 索引
    const safeStartIdx = Math.min(archivedMessageCount, Math.max(0, fullMessages.length - MIN_RESERVE));
    let workingMessages = fullMessages.slice(safeStartIdx);

    // 2. 静态处理
    workingMessages = foldObsoleteToolMessages(workingMessages);
    workingMessages = microcompactMessages(workingMessages);

    // 3. 动态摘要压缩逻辑
    let currentTokens = estimateMessagesTokens(assembleFinalSequence(rollingSummary, workingMessages));

    // 策略：为了 Cache，将阈值提得更高（0.95），压缩得更狠（50%），以减少摘要更新频率
    const shouldCompact = currentTokens > MAX_HIST * 0.95 || (MAX_MSG_COUNT > 0 && workingMessages.length > MAX_MSG_COUNT);
    const isCircuitBroken = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

    if (shouldCompact && !isCircuitBroken && workingMessages.length > MIN_RESERVE) {
        try {
            // 一次性清理掉活跃区一半的消息，腾出巨大空间换取缓存稳定期
            const itemsToMergeCount = Math.floor(workingMessages.length * 0.5);
            const batch = workingMessages.slice(0, itemsToMergeCount);

            rollingSummary = await mergeRollingSummary(rollingSummary, batch);
            archivedMessageCount = safeStartIdx + itemsToMergeCount;
            workingMessages = workingMessages.slice(itemsToMergeCount);

            consecutiveFailures = 0;
        } catch (e) {
            console.error("[Context] Merge failed:", e);
            consecutiveFailures++;
        }
    }

    // 4. 组装与兜底
    let readyMessages = assembleFinalSequence(rollingSummary, workingMessages);

    if (estimateMessagesTokens(readyMessages) > MAX_HIST) {
        readyMessages = trimMessagesToTokenBudget(readyMessages, {
            maxTokens: MAX_HIST,
            singleMessageMaxTokens: SINGLE_MAX
        });
    }

    return {
        messages: readyMessages,
        rolling: { rollingSummary, archivedMessageCount, consecutiveFailures },
    };
}

/**
 * 💡 后台维护函数 (Cache 保护增强版)
 */
export async function triggerBackgroundMaintenance(
    fullMessages: ChatMessage[],
    rolling: RollingState,
    onUpdate: (next: RollingState) => Promise<void>
) {
    if ((rolling.consecutiveFailures || 0) >= MAX_CONSECUTIVE_FAILURES) return;

    const rawTail = fullMessages.slice(rolling.archivedMessageCount);

    // 只有当快满（90%）时才在后台操作，避免频繁更新摘要导致用户提问时 Cache Miss
    if (estimateMessagesTokens(rawTail) > MAX_HIST * 0.9) {
        try {
            const batchSize = Math.floor(rawTail.length * 0.5);
            const batch = microcompactMessages(rawTail.slice(0, batchSize));
            const newSummary = await mergeRollingSummary(rolling.rollingSummary, batch);

            await onUpdate({
                rollingSummary: newSummary,
                archivedMessageCount: rolling.archivedMessageCount + batchSize,
                consecutiveFailures: 0,
            });
        } catch (e) {
            if ((rolling.consecutiveFailures || 0) < MAX_CONSECUTIVE_FAILURES) {
                await onUpdate({
                    ...rolling,
                    consecutiveFailures: (rolling.consecutiveFailures || 0) + 1
                });
            }
        }
    }
}
