/**
 * 将完整转录 + 持久化滚动摘要组装为发给模型的 messages（token 预算 + 滚动合并）
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

const MERGE_CHUNK = 15;

function sanitizeRolling(fullLen: number, rolling: RollingState): RollingState {
    if (rolling.archivedMessageCount > fullLen) {
        return { rollingSummary: "", archivedMessageCount: 0 };
    }
    return rolling;
}

function summaryBlockMsgs(rollingSummary: string): ChatMessage[] {
    const t = rollingSummary.trim();
    if (!t.length) return [];
    return [{ role: "system", content: `【此前对话摘要】\n${t}` }];
}

/** 将一批消息折入滚动摘要；条数过多时先整段摘要再合并，避免单次 merge 提示过长 */
async function foldDroppedIntoRolling(
    previous: string,
    dropped: ChatMessage[]
): Promise<string> {
    if (dropped.length === 0) return previous;
    if (dropped.length <= MERGE_CHUNK) {
        return mergeRollingSummary(previous, dropped);
    }
    const chunk = await summarizeMessages(dropped);
    return mergeRollingSummary(previous, [
        {
            role: "user",
            content: `（以下为被裁剪的较早对话的系统摘要）\n${chunk}`,
        },
    ]);
}

export async function buildMessagesForModel(
    fullMessages: ChatMessage[],
    rolling: RollingState
): Promise<BuildModelContextResult> {
    const maxHist = appConfig.chatHistoryMaxTokens;
    const singleMax = appConfig.chatSingleMessageMaxTokens;
    const maxMsg = appConfig.chatContextMaxMessages;

    let { rollingSummary, archivedMessageCount } = sanitizeRolling(
        fullMessages.length,
        rolling
    );

    let rawTail = fullMessages.slice(archivedMessageCount);

    if (maxMsg > 0 && rawTail.length > maxMsg) {
        const dropped = rawTail.slice(0, rawTail.length - maxMsg);
        rawTail = rawTail.slice(-maxMsg);
        rollingSummary = await foldDroppedIntoRolling(rollingSummary, dropped);
        archivedMessageCount += dropped.length;
    }

    for (;;) {
        const sb = summaryBlockMsgs(rollingSummary);
        const candidate = [...sb, ...rawTail];
        if (estimateMessagesTokens(candidate) <= maxHist) break;

        if (rawTail.length > 1) {
            const first = rawTail[0]!;
            rawTail = rawTail.slice(1);
            rollingSummary = await mergeRollingSummary(rollingSummary, [first]);
            archivedMessageCount++;
            continue;
        }

        if (rawTail.length === 1) {
            const sbTokens = estimateMessagesTokens(sb);
            const budgetForContent = Math.max(0, maxHist - sbTokens - 4);
            const content = trimMessageContentTail(rawTail[0]!.content, budgetForContent);
            rawTail = [{ role: rawTail[0]!.role, content }];
            break;
        }

        if (sb.length > 0) {
            rollingSummary = trimMessageContentTail(rollingSummary, Math.max(100, maxHist - 8));
        }
        break;
    }

    const sb = summaryBlockMsgs(rollingSummary);
    let core = [...sb, ...rawTail];
    core = trimMessagesToTokenBudget(core, {
        maxTokens: maxHist,
        singleMessageMaxTokens: singleMax,
    });

    return {
        messages: core,
        rolling: { rollingSummary, archivedMessageCount },
    };
}
