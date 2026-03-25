/**
 * 将一段对话历史总结成简短摘要，用于压缩上下文（混合方案：总结 + 最近消息）
 */

import type { ChatMessage } from "../llm/providers/ModelProvider";
import { chatWithModel } from "../llm/model";

const SUMMARIZE_SYSTEM = `你是一个对话摘要助手。请将下面这段对话历史总结成一段简短的摘要（中文），保留：谁说了什么、主要结论或事实。控制在 300 字以内。`;

/**
 * 把 messages 交给 LLM 总结成一段文字
 */
export async function summarizeMessages(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return "";
    const text = messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join("\n\n");
    const summary = await chatWithModel([
        { role: "system", content: SUMMARIZE_SYSTEM },
        { role: "user", content: `请总结以下对话：\n\n${text}` },
    ]);
    return summary.trim();
}