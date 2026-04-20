import type { ModelProvider } from "../ModelProvider";
import type {
    ChatMessage,
    AgentMessage,
    ToolSchema,
    ChatWithToolsResult,
} from "../ModelProvider";
import { chatWithOllama } from "./ollamaClient";
import { chatWithOllamaWithTools } from "./ollamaClient";

export type OllamaProviderOptions = Partial<{
    baseUrl: string;
    modelName: string;
    temperature: number;
}>;

export class OllamaProvider implements ModelProvider {
    constructor(private readonly options: OllamaProviderOptions = {}) {}

    async chat(messages: ChatMessage[]): Promise<string> {
        // 现在的 chatWithOllama 已经可以接受 ChatMessage[]（它是 AgentMessage 的子集）
        return chatWithOllama(messages, this.options);
    }

    async chatWithTools(
        messages: AgentMessage[],
        tools: ToolSchema[]
    ): Promise<ChatWithToolsResult> {
        // 现在的函数签名完全匹配
        return chatWithOllamaWithTools(messages, tools, this.options);
    }
}