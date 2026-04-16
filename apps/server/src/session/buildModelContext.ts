/**
 * 智能上下文组装工具
 * 核心：懒加载摘要、微压缩处理、语义锚点保护
 */

import type { ChatMessage } from "@/llm/providers/ModelProvider";
import { appConfig } from "@/config/evn";
import {
    estimateMessagesTokens,
    trimMessagesToTokenBudget,
    trimMessageContentTail,
} from "@/session/contextLimit";
import { mergeRollingSummary, summarizeMessages } from "@/session/summarizeContext";
import type { RollingState } from "@/session/store";

export type BuildModelContextResult = {
    messages: ChatMessage[];
    rolling: RollingState;
};

/**
 * 【微压缩】
 * 零成本减少 Token 消耗，清理冗余格式
 */
function applyMicroCompression(content: string): string {
    return content
        .replace(/\n{3,}/g, '\n\n') // 压缩多余换行
        .replace(/[ \t]{3,}/g, ' ')  // 压缩多余空格
        .trim();
}

/**
 * 【结构化包装】
 * 增加引导词，确保护持摘要信息的一致性
 */
function summaryBlockMsgs(rollingSummary: string): ChatMessage[] {
    const t = rollingSummary.trim();
    if (!t.length) return [];
    return [{ 
        role: "system", 
        content: `[前情提要/核心设定]\n${t}\n请务必保持对话事实的一致性。` 
    }];
}

/**
 * 校验滚动状态
 */
function sanitizeRolling(fullLen: number, rolling: RollingState): RollingState {
    if (rolling.archivedMessageCount > fullLen) {
        return { rollingSummary: "", archivedMessageCount: 0 };
    }
    return rolling;
}

/**
 * 核心逻辑：组装上下文
 */
export async function buildMessagesForModel(
    fullMessages: ChatMessage[],
    rolling: RollingState
): Promise<BuildModelContextResult> {
    // 1. 初始化配置
    const mergeChunk = Math.max(1, appConfig.chatRollingMergeChunk);
    const maxHist = appConfig.chatHistoryMaxTokens;
    const singleMax = appConfig.chatSingleMessageMaxTokens;
    const maxMsg = appConfig.chatContextMaxMessages;

    let { rollingSummary, archivedMessageCount } = sanitizeRolling(fullMessages.length, rolling);
    let rawTail = fullMessages.slice(archivedMessageCount);

    // 2. 预检当前状态
    const initialSb = summaryBlockMsgs(rollingSummary);
    const currentTokens = estimateMessagesTokens([...initialSb, ...rawTail]);

    // --- 【策略优化：懒触发】 ---
    // 只有当 Token 占用超过 90% 或者消息条数达到 100% 时，才触发昂贵的摘要更新
    const isTokenTight = currentTokens > maxHist * 0.9;
    const isCountOverflow = maxMsg > 0 && rawTail.length >= maxMsg;

    if (isTokenTight || isCountOverflow) {
        // --- 【策略优化：大跳跃合并】 ---
        // 为了避免频繁调用，一旦触发，就一次性合并掉“一整块”消息（例如总限额的 30%）
        // 这样可以保证未来几轮对话都不需要再次生成摘要
        let itemsToMerge = 0;
        let tokensToReduce = 0;

        if (isCountOverflow) {
            // 至少腾出 30% 的条数空间
            itemsToMerge = Math.max(mergeChunk, Math.floor(maxMsg * 0.3));
        } else {
            // 至少腾出 20% 的 Token 空间
            const targetReduction = maxHist * 0.2;
            let acc = 0;
            for (let i = 0; i < rawTail.length - 1; i++) {
                acc += estimateMessagesTokens([rawTail[i]]);
                itemsToMerge++;
                if (acc >= targetReduction) break;
            }
        }

        // 确保不会把所有消息都吸掉，至少留一条
        itemsToMerge = Math.min(itemsToMerge, rawTail.length - 1);

        if (itemsToMerge > 0) {
            const batch = rawTail.slice(0, itemsToMerge).map(m => ({
                ...m,
                content: applyMicroCompression(m.content) // 合并前微压缩
            }));
            rawTail = rawTail.slice(itemsToMerge);

            // 执行一次性异步摘要合并
            // 建议 mergeRollingSummary 内部 Prompt 使用“增量更新”模式
            rollingSummary = await mergeRollingSummary(rollingSummary, batch);
            archivedMessageCount += itemsToMerge;
        }
    }

    // 3. 极端边界处理：如果摘要+最后一条仍然超标
    let sb = summaryBlockMsgs(rollingSummary);
    if (estimateMessagesTokens([...sb, ...rawTail]) > maxHist) {
        if (rawTail.length === 1) {
            const budget = Math.max(10, maxHist - estimateMessagesTokens(sb) - 5);
            rawTail[0].content = trimMessageContentTail(rawTail[0].content, budget);
        } else if (estimateMessagesTokens(sb) > maxHist) {
            rollingSummary = trimMessageContentTail(rollingSummary, maxHist - 20);
            sb = summaryBlockMsgs(rollingSummary);
        }
    }

    // 4. 最终构建与严格裁剪
    let core = trimMessagesToTokenBudget([...sb, ...rawTail], {
        maxTokens: maxHist,
        singleMessageMaxTokens: singleMax,
    });

    return {
        messages: core,
        rolling: { rollingSummary, archivedMessageCount },
    };
}

/**
 * 💡 后台静默维护函数
 * 建议在 AI 回复完后触发，不影响用户主流程
 */
export async function triggerBackgroundMaintenance(
    fullMessages: ChatMessage[],
    rolling: RollingState,
    onUpdate: (next: RollingState) => Promise<void>
) {
    // 后台逻辑可以更激进一点：只要占用超过 70% 就可以提前开始后台摘要
    const maxMsg = appConfig.chatContextMaxMessages;
    const rawTail = fullMessages.slice(rolling.archivedMessageCount);

    if (maxMsg > 0 && rawTail.length > maxMsg * 0.7) {
        try {
            const batchSize = Math.max(1, appConfig.chatRollingMergeChunk);
            const batch = rawTail.slice(0, batchSize);
            const newSummary = await mergeRollingSummary(rolling.rollingSummary, batch);
            
            await onUpdate({
                rollingSummary: newSummary,
                archivedMessageCount: rolling.archivedMessageCount + batchSize
            });
        } catch (e) {
            console.warn("Background summary failed silently.");
        }
    }
}
