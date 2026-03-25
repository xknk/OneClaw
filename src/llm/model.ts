/**
 * LLM 模块对外入口：只暴露消息类型与对话方法，具体模型由 Provider 负责。
 */

import type {
    ChatMessage,
    AgentMessage,
    ToolSchema,
    ChatWithToolsResult,
    ModelProvider,
} from "./providers/ModelProvider";
import { OllamaProvider } from "./providers/ollama/OllamaProvider";

export type { ChatMessage, AgentMessage, ToolSchema, ChatWithToolsResult };

function getDefaultProvider(): ModelProvider {
    return new OllamaProvider();
}

/** 与当前配置的模型进行一轮普通对话 */
export async function chatWithModel(messages: ChatMessage[]): Promise<string> {
    const provider = getDefaultProvider();
    return provider.chat(messages);
}

/**
 * 与当前配置的模型进行一轮带工具对话；若当前 Provider 未实现则抛错。
 * 换模型时只需在 getDefaultProvider 中返回其他 Provider，Agent 无需改。
 */
export async function chatWithModelWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[]
): Promise<ChatWithToolsResult> {
    const provider = getDefaultProvider();
    if (typeof provider.chatWithTools !== "function") {
        throw new Error("当前模型不支持工具调用，请使用支持 tool calling 的模型（如 Ollama 的 qwen3）");
    }
    return provider.chatWithTools(messages, tools);
}