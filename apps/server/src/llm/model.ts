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
import { ZhiPuProvider } from "./providers/zhipu/ZhiPuProvider";

export type { ChatMessage, AgentMessage, ToolSchema, ChatWithToolsResult };

function getDefaultProvider(): ModelProvider {
    return new OllamaProvider();
}

function getZhiPuProvider(): ModelProvider {
    return new ZhiPuProvider();
}

/** 与当前配置的模型进行一轮普通对话 */
export async function chatWithModel(messages: ChatMessage[], type: "ollama" | "zhipu" = 'zhipu'): Promise<string> {
    let provider: ModelProvider;
    if (type === "ollama") {
        provider = getDefaultProvider();
    } else if (type === "zhipu") {
        provider = getZhiPuProvider();
    } else {
        throw new Error("不支持的模型类型");
    }
    return provider.chat(messages);
}

/**
 * 与当前配置的模型进行一轮带工具对话；若当前 Provider 未实现则抛错。
 * 换模型时只需在 getDefaultProvider 中返回其他 Provider，Agent 无需改。
 */
export async function chatWithModelWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[],
    type: "ollama" | "zhipu" = 'zhipu'
): Promise<ChatWithToolsResult> {
    let provider: ModelProvider;
    if (type === "ollama") {
        provider = getDefaultProvider();
    } else if (type === "zhipu") {
        provider = getZhiPuProvider();
    } else {
        throw new Error("不支持的模型类型");
    }
    if (typeof provider.chatWithTools !== "function") {
        throw new Error("当前模型不支持工具调用，请使用支持 tool calling 的模型（如 Ollama 的 qwen3）");
    }
    return provider.chatWithTools(messages, tools);
}