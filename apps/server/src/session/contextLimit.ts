/**
 * 上下文长度工具 (五级流水线适配版)
 */

import type { ChatMessage } from "../llm/providers/ModelProvider";

export interface TrimMessagesOptions {
    maxMessages?: number;
}

/** 
 * 1. 基础 Token 估算
 * 针对智谱等中英文混合模型：中文字符 1:1，英文字符 4:1
 */
export function estimateTextTokens(text: string | null | undefined): number {
    if (!text) return 0; // 👈 关键：防御 null/undefined
    let cjk = 0;
    let rest = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        // 扩展 CJK 范围，涵盖更多标点和常用字符
        if (c >= 0x4e00 && c <= 0x9fff) cjk++;
        else rest++;
    }
    return cjk + Math.ceil(rest / 4);
}

/**
 * 2. 消息数组 Token 估算
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((total, m) => {
        const tokens = estimateTextTokens(m.content) + 4; // 4 为消息结构开销
        return total + (isNaN(tokens) ? 0 : tokens);
    }, 0);
}

/** 
 * 3. 针对“核弹级”长消息的尾部截断
 */
export function trimMessageContentTail(content: string | null | undefined, maxTokens: number): string {
    if (!content) return "";
    if (estimateTextTokens(content) <= maxTokens) return content;

    let low = 0;
    let high = content.length;
    // 使用二分查找快速定位截断点
    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        const slice = content.slice(mid);
        if (estimateTextTokens(slice) <= maxTokens) {
            high = mid - 1;
        } else {
            low = mid;
        }
    }
    const start = Math.min(low, content.length);
    return `[…此前内容已截断…]\n${content.slice(start)}`;
}

/**
 * 4. 物理保底裁剪
 * 策略：从最新消息往前装填，直到 Token 预算耗尽
 */
export interface TrimToTokenBudgetOptions {
    maxTokens: number;
    singleMessageMaxTokens: number;
}

export function trimMessagesToTokenBudget(
    messages: ChatMessage[],
    options: TrimToTokenBudgetOptions
): ChatMessage[] {
    const { maxTokens, singleMessageMaxTokens } = options;
    const out: ChatMessage[] = [];
    let used = 0;

    // 始终尝试保留第一条 system 消息（如果存在且是人设）
    const systemMsg = messages.find(m => m.role === 'system');
    let systemTokens = 0;
    if (systemMsg) {
        systemTokens = estimateTextTokens(systemMsg.content) + 4;
    }

    // 从后往前遍历
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        
        // 跳过 system 消息（稍后单独处理或已处理）
        if (m.role === 'system') continue;

        let content = m.content || "";
        let t = estimateTextTokens(content) + 4;

        // 如果单条消息超标，先进行内部截断
        if (t > singleMessageMaxTokens) {
            content = trimMessageContentTail(content, singleMessageMaxTokens);
            t = estimateTextTokens(content) + 4;
        }

        // 检查加上这一条后是否会超过总预算（预留 system 空间）
        if (used + t + systemTokens > maxTokens) break;

        used += t;
        // 注意：这里需要深拷贝或重建对象，避免污染原始数据
        out.push({ ...m, content });
    }

    // 将保留的消息反转回正常顺序
    const finalResult = out.reverse();

    // 如果有 system 消息，将其插入到最前面
    if (systemMsg && used + systemTokens <= maxTokens) {
        finalResult.unshift(systemMsg);
    }

    return finalResult;
}

/**
 * 5. 简单的消息数量限制
 */
export function trimMessagesToContextLimit(
    messages: ChatMessage[],
    options: TrimMessagesOptions = {}
): ChatMessage[] {
    const max = options.maxMessages ?? 30;
    if (messages.length <= max) return messages;
    
    // 同样建议保留第一条 system 消息
    const hasSystem = messages[0]?.role === 'system';
    if (hasSystem) {
        return [messages[0], ...messages.slice(-(max - 1))];
    }
    return messages.slice(-max);
}
