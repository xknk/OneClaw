export type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

/** 与具体 API 无关的工具描述，供各 Provider 转成自家格式 */
export type ToolSchema = {
    name: string;
    description: string;
    parameters?: {
        type: "object";
        properties?: Record<string, { type: string; description?: string }>;
        required?: string[];
    };
};

/** 带工具的一轮对话返回：正文 + 本轮的 tool_calls */
export type ChatWithToolsResult = {
    content: string;
    toolCalls: Array<{
        id?: string; name: string; args: Record<string, unknown>
    }>;
};

/** 工具结果消息（用于多轮时把工具输出塞回对话） */
export type ToolResultMessage = {
    role: "tool";
    tool_name: string;
    content: string;
};

/** 带 tool_calls 的 assistant 消息（用于多轮时把模型上次的 tool_calls 塞回对话） */
export type AssistantWithToolCallsMessage = {
    role: "assistant";
    content: string;
    tool_calls: Array<{
        id: string; name: string; args: Record<string, unknown>
    }>;
};

/** Agent 多轮对话中的消息：普通对话 | 带 tool_calls 的 assistant | 工具结果 */
export type AgentMessage =
    | ChatMessage
    | AssistantWithToolCallsMessage
    | ToolResultMessage;

export interface ModelProvider {
    chat(messages: ChatMessage[]): Promise<string>;

    /**
     * 可选：带工具的一轮对话。未实现的 Provider 可不定义或抛错。
     * 换模型时只需新 Provider 实现此方法，Agent 无需改动。
     */
    chatWithTools?(messages: AgentMessage[], tools: ToolSchema[]): Promise<ChatWithToolsResult>;
}