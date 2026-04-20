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
    signal?: AbortSignal;
    onAssistantTextDelta?: (chunk: string) => void;
}>;

export class ZhiPuProvider implements ModelProvider {
    constructor(private readonly options: ZhiPuProviderOptions = {}) {}

    async chat(messages: ChatMessage[]): Promise<string> {  
        return chatWithZhiPu(messages, this.options);
    }

    async chatWithTools(
        messages: AgentMessage[],
        tools: ToolSchema[],
        callOpts?: { signal?: AbortSignal; onAssistantTextDelta?: (chunk: string) => void },
    ): Promise<ChatWithToolsResult> {
        return chatWithZhiPuWithTools(messages, tools, {
            ...this.options,
            signal: callOpts?.signal ?? this.options.signal,
            onAssistantTextDelta: callOpts?.onAssistantTextDelta ?? this.options.onAssistantTextDelta,
        });
    }
}