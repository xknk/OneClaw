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
import { resolveModelRuntime } from "./modelCatalog";

export type { ChatMessage, AgentMessage, ToolSchema, ChatWithToolsResult };

function getProviderByKey(modelKey: string): ModelProvider {
    const key = (modelKey || "").trim();
    // 兼容旧字段（driver）
    if (key === "ollama") return new OllamaProvider();
    if (key === "zhipu") return new ZhiPuProvider();

    // 新：从 models.json 按 modelId 解析
    const rt = resolveModelRuntime(key);
    if (rt.driver === "ollama") {
        return new OllamaProvider({
            baseUrl: rt.baseUrl,
            modelName: rt.modelName,
            temperature: rt.temperature,
        });
    }
    // zhipu
    return new ZhiPuProvider({
        baseUrl: rt.baseUrl,
        modelName: rt.modelName,
        apiKey: rt.apiKey,
        temperature: rt.temperature,
    });
}

/** 与当前配置的模型进行一轮普通对话 */
export async function chatWithModel(messages: ChatMessage[], modelKey: string = "zhipu"): Promise<string> {
    return getProviderByKey(modelKey).chat(messages);
}

/**
 * 与当前配置的模型进行一轮带工具对话；若当前 Provider 未实现则抛错。
 * 换模型时只需在 getDefaultProvider 中返回其他 Provider，Agent 无需改。
 */
export async function chatWithModelWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[],
    modelKey: string = "zhipu"
): Promise<ChatWithToolsResult> {
    const provider = getProviderByKey(modelKey);
    if (typeof provider.chatWithTools !== "function") {
        throw new Error("当前模型不支持工具调用，请使用支持 tool calling 的模型（如 Ollama 的 qwen3）");
    }
    return provider.chatWithTools(messages, tools);
}