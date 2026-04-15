import type { ModelProvider } from "../ModelProvider";
import type {
    ChatMessage,
    AgentMessage,
    ToolSchema,
    ChatWithToolsResult,
} from "../ModelProvider";
import { chatWithZhiPu } from "./ZhiPuClient";
import { chatWithZhiPuWithTools } from "./ZhiPuClient";

export class ZhiPuProvider implements ModelProvider {
    async chat(messages: ChatMessage[]): Promise<string> {  
        return chatWithZhiPu(messages);
    }

    async chatWithTools(
        messages: AgentMessage[],
        tools: ToolSchema[]
    ): Promise<ChatWithToolsResult> {
        return chatWithZhiPuWithTools(messages, tools);
    }
}