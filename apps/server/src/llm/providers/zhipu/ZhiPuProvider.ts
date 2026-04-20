import type { ModelProvider } from "../ModelProvider";
import type {
    ChatMessage,
    AgentMessage,
    ToolSchema,
    ChatWithToolsResult,
} from "../ModelProvider";
import { chatWithZhiPu } from "./ZhiPuClient";
import { chatWithZhiPuWithTools } from "./ZhiPuClient";

export type ZhiPuProviderOptions = Partial<{
    baseUrl: string;
    modelName: string;
    apiKey: string;
    temperature: number;
}>;

export class ZhiPuProvider implements ModelProvider {
    constructor(private readonly options: ZhiPuProviderOptions = {}) {}

    async chat(messages: ChatMessage[]): Promise<string> {  
        return chatWithZhiPu(messages, this.options);
    }

    async chatWithTools(
        messages: AgentMessage[],
        tools: ToolSchema[]
    ): Promise<ChatWithToolsResult> {
        return chatWithZhiPuWithTools(messages, tools, this.options);
    }
}