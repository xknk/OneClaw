/**
 * 智能上下文组装工具 (生产级 Cache 极致优化版)
 */

import type { ChatMessage } from "@/llm/providers/ModelProvider";
import { appConfig } from "@/config/evn";
import {
    estimateMessagesTokens,
    trimMessagesToTokenBudget, // 👈 第三道防线：整体保底工具
    estimateTextTokens,
    trimMessageContentTail,
} from "@/session/contextLimit";
import { mergeRollingSummary } from "@/session/summarizeContext";
import type { RollingState } from "@/session/store";

export type BuildModelContextResult = {
    messages: ChatMessage[];
    rolling: RollingState;
};

// --- 【工具辅助函数】 ---

function applyMicroCompression(content: string): string {
    return content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{3,}/g, ' ')
        .trim();
}

function sanitizeRolling(fullLen: number, rolling: RollingState): RollingState {
    if (rolling.archivedMessageCount > fullLen) {
        return { rollingSummary: "", archivedMessageCount: 0 };
    }
    return rolling;
}


/**
 * 【Cache 友好消息组装器】
 * 将摘要后置，保护对话前缀缓存
 */
function assembleMessages(summary: string, tail: ChatMessage[]): ChatMessage[] {
    const msgs: ChatMessage[] = [];

    // 1. 绝对不变的人设 (永远是缓存的起点)
    msgs.push({ role: "system", content: "你是一个专业的助手。" });

    // 2. 原始对话流 (只要摘要不插在中间，这部分缓存就稳固)
    // 即使你增加了新消息，前缀依然匹配
    msgs.push(...tail);

    // 3. 【核心改动】将摘要放在最后
    // 这样即便摘要从“无”变成“有”，或者从“版本A”变成“版本B”，
    // 它都不会影响前面固定人设和 tail 对话的 Hash 匹配。
    if (summary.trim()) {
        msgs.push({ 
            role: "system", 
            content: `[历史背景归档]\n${summary.trim()}` 
        });
    }
    return msgs;
}

// --- 【核心主流程】 ---

export async function buildMessagesForModel(
    fullMessages: ChatMessage[],
    rolling: RollingState
): Promise<BuildModelContextResult> {
    const MAX_HIST = appConfig.chatHistoryMaxTokens;
    const MAX_MSG = appConfig.chatContextMaxMessages;
    const MIN_RESERVE = appConfig.chatContextReserveMessages;
    const SINGLE_MAX = appConfig.chatSingleMessageMaxTokens;

    let { rollingSummary, archivedMessageCount } = sanitizeRolling(fullMessages.length, rolling);

    const safeArchivedIdx = Math.min(
        archivedMessageCount,
        Math.max(0, fullMessages.length - MIN_RESERVE)
    );
    let rawTail = fullMessages.slice(safeArchivedIdx);

    // 1. 预检 Token
    let currentTokens = estimateMessagesTokens(assembleMessages(rollingSummary, rawTail));

    // 2. 第一道防线：触发摘要合并策略 (Cache 友好型：高阈值 + 深度腾挪)
    const isTokenTight = currentTokens > MAX_HIST * 0.95;
    const isCountOverflow = MAX_MSG > 0 && rawTail.length >= MAX_MSG;

    if ((isTokenTight || isCountOverflow) && rawTail.length > MIN_RESERVE) {
        let itemsToMerge = 0;
        if (isCountOverflow) {
            itemsToMerge = rawTail.length - Math.floor(MAX_MSG * 0.4);
        } else {
            const targetTokens = MAX_HIST * 0.4;
            let acc = currentTokens;
            for (let i = 0; i < rawTail.length - MIN_RESERVE; i++) {
                acc -= estimateMessagesTokens([rawTail[i]]);
                itemsToMerge++;
                if (acc <= targetTokens) break;
            }
        }

        itemsToMerge = Math.max(0, Math.min(itemsToMerge, rawTail.length - MIN_RESERVE));

        if (itemsToMerge > 0) {
            const batch = rawTail.slice(0, itemsToMerge).map(m => ({
                ...m,
                content: applyMicroCompression(m.content)
            }));
            try {
                rollingSummary = await mergeRollingSummary(rollingSummary, batch);
                archivedMessageCount = safeArchivedIdx + itemsToMerge;
                rawTail = rawTail.slice(itemsToMerge);
            } catch (e) {
                console.error("[Context] Summary error:", e);
            }
        }
    }

    // 3. 第二道防线：显式处理单条“核弹级”长消息
    if (rawTail.length > 0) {
        const lastMsg = rawTail[rawTail.length - 1];
        if (estimateTextTokens(lastMsg.content) > SINGLE_MAX) {
            lastMsg.content = trimMessageContentTail(lastMsg.content, SINGLE_MAX);
        }
    }

    // 4. 组装最终结果
    let finalMessages = assembleMessages(rollingSummary, rawTail);

    // 5. 第三道防线：整体物理保底裁剪 (确保 100% 不超标)
    if (estimateMessagesTokens(finalMessages) > MAX_HIST) {
        finalMessages = trimMessagesToTokenBudget(finalMessages, {
            maxTokens: MAX_HIST,
            singleMessageMaxTokens: SINGLE_MAX,
        });
    }

    return {
        messages: finalMessages,
        rolling: { rollingSummary, archivedMessageCount },
    };
}


/**
 * 💡 后台维护函数 (Cache 友好版)
 * 只有当绝对必要时才在后台更新摘要
 */
export async function triggerBackgroundMaintenance(
    fullMessages: ChatMessage[],
    rolling: RollingState,
    onUpdate: (next: RollingState) => Promise<void>
) {
    const MAX_MSG_COUNT = appConfig.chatContextMaxMessages;

    const rawTail = fullMessages.slice(rolling.archivedMessageCount);
    // 提高后台维护的门槛：只有超过 90% 载荷才在后台偷偷合并
    // 避免频繁的后台更新导致用户下次提问时缓存失效
    if (MAX_MSG_COUNT > 0 && rawTail.length > MAX_MSG_COUNT * 0.9) {
        try {
            // 一次性合并一大块，长痛不如短痛
            const batchSize = Math.floor(MAX_MSG_COUNT * 0.5);
            const batch = rawTail.slice(0, batchSize).map(m => ({
                ...m,
                content: applyMicroCompression(m.content)
            }));

            const newSummary = await mergeRollingSummary(rolling.rollingSummary, batch);

            await onUpdate({
                rollingSummary: newSummary,
                archivedMessageCount: rolling.archivedMessageCount + batchSize
            });
        } catch (e) {
            console.warn("Background summary skipped.");
        }
    }
}
