import type { ModelProvider } from "../ModelProvider";
import type {
    ChatMessage,
    AgentMessage,
    ToolSchema,
    ChatWithToolsResult,
} from "../ModelProvider";
import { chatWithOllama } from "./ollamaClient";
import { chatWithOllamaWithTools } from "./ollamaClient";

export class OllamaProvider implements ModelProvider {
    async chat(messages: ChatMessage[]): Promise<string> {
        return chatWithOllama(messages);
    }

    async chatWithTools(
        messages: AgentMessage[],
        tools: ToolSchema[]
    ): Promise<ChatWithToolsResult> {
        return chatWithOllamaWithTools(messages, tools);
    }
}