/**
 * 上下文长度控制：发给模型前截断，避免超出 context window
 * 策略：只保留最近 N 条消息
 */

import type { ChatMessage } from "../llm/providers/ModelProvider";

export interface TrimMessagesOptions {
    maxMessages?: number;
}

/**
 * 只保留最近 maxMessages 条；不足则全部保留。不修改原数组。
 */
export function trimMessagesToContextLimit(
    messages: ChatMessage[],
    options: TrimMessagesOptions = {}
): ChatMessage[] {
    const max = options.maxMessages ?? 30;
    if (messages.length <= max) return messages;
    return messages.slice(-max);
}