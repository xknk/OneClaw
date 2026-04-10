/**
 * 将一段对话历史总结成简短摘要，用于压缩上下文（混合方案：总结 + 最近消息）
 */

import type { ChatMessage } from "../llm/providers/ModelProvider";
import { chatWithModel } from "../llm/model";
import { appConfig } from "@/config/evn";

function summarizeSystemPrompt(): string {
    if (appConfig.uiLocale === "en") {
        return `You are a conversation summarizer. Summarize the dialogue history below in a short paragraph (English). Keep: who said what, main conclusions or facts. Max ~300 words.`;
    }
    return `你是一个对话摘要助手。请将下面这段对话历史总结成一段简短的摘要（中文），保留：谁说了什么、主要结论或事实。控制在 300 字以内。`;
}

function summarizeUserPrompt(text: string): string {
    if (appConfig.uiLocale === "en") {
        return `Summarize the following conversation:\n\n${text}`;
    }
    return `请总结以下对话：\n\n${text}`;
}

/**
 * 把 messages 交给 LLM 总结成一段文字
 */
export async function summarizeMessages(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return "";
    const text = messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join("\n\n");
    const summary = await chatWithModel([
        { role: "system", content: summarizeSystemPrompt() },
        { role: "user", content: summarizeUserPrompt(text) },
    ]);
    return summary.trim();
}

function mergeSystemPrompt(): string {
    if (appConfig.uiLocale === "en") {
        return `You merge a running conversation summary with new dialogue lines. Output ONE updated English paragraph. Preserve: constraints, decisions, names, versions, paths, unresolved tasks. Drop filler. Max ~350 words.`;
    }
    return `你会把「已有摘要」和「新出现的若干条对话」合并成一段更新后的中文摘要。输出一段即可。必须保留：约束条件、已做决定、专名、版本号、路径、未完成任务。去掉废话。总长度控制在 350 字以内。`;
}

function mergeUserPrompt(prev: string, batch: ChatMessage[]): string {
    const block = batch.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
    if (appConfig.uiLocale === "en") {
        return `Previous summary:\n${prev || "(empty)"}\n\nNew lines to fold in:\n${block}`;
    }
    return `已有摘要：\n${prev || "（无）"}\n\n新并入的对话：\n${block}`;
}

/** 将新消息折入滚动摘要（增量） */
export async function mergeRollingSummary(
    previousSummary: string,
    newMessages: ChatMessage[]
): Promise<string> {
    if (newMessages.length === 0) return previousSummary.trim();
    const summary = await chatWithModel([
        { role: "system", content: mergeSystemPrompt() },
        { role: "user", content: mergeUserPrompt(previousSummary, newMessages) },
    ]);
    return summary.trim();
}