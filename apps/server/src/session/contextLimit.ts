/**
 * 上下文长度：估算 token，并按预算从最新消息往前保留
 */

import type { ChatMessage } from "../llm/providers/ModelProvider";

export interface TrimMessagesOptions {
    maxMessages?: number;
}

/** 保守估算：中日文字符约 1 token，其余约 4 字符 1 token */
export function estimateTextTokens(text: string): number {
    if (!text) return 0;
    let cjk = 0;
    let rest = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0x4e00 && c <= 0x9fff) cjk++;
        else rest++;
    }
    return cjk + Math.ceil(rest / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((s, m) => s + estimateTextTokens(m.content) + 4, 0);
}

/** 过长单条：从尾部保留（适合日志/代码） */
export function trimMessageContentTail(content: string, maxTokens: number): string {
    if (estimateTextTokens(content) <= maxTokens) return content;
    let low = 0;
    let high = content.length;
    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        const slice = content.slice(mid);
        if (estimateTextTokens(slice) <= maxTokens) high = mid - 1;
        else low = mid;
    }
    const start = Math.min(low, content.length);
    return `[…此前内容已截断…]\n${content.slice(start)}`;
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

export interface TrimToTokenBudgetOptions {
    maxTokens: number;
    singleMessageMaxTokens: number;
}

/**
 * 从数组末尾往前装填，使总估算 token <= maxTokens。
 */
export function trimMessagesToTokenBudget(
    messages: ChatMessage[],
    options: TrimToTokenBudgetOptions
): ChatMessage[] {
    const { maxTokens, singleMessageMaxTokens } = options;
    const out: ChatMessage[] = [];
    let used = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        let content = m.content;
        let t = estimateTextTokens(content) + 4;
        if (t > singleMessageMaxTokens) {
            content = trimMessageContentTail(content, singleMessageMaxTokens);
            t = estimateTextTokens(content) + 4;
        }
        if (used + t > maxTokens) break;
        used += t;
        out.push({ role: m.role, content });
    }
    return out.reverse();
}
