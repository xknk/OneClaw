export type ChatMessage =

    | { role: "system"; content: string; tool_calls?: never }
    | { role: "user"; content: string; tool_calls?: never }
    | {
        role: "assistant";
        content: string;
        // 允许 assistant 携带工具调用指令
        tool_calls?: {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
        }[];
    }
    | {
        role: "tool";
        content: string;
        tool_call_id?: string; // 某些厂商（如智谱、OpenAI）需要这个 ID
    };
/** 供各 Provider 转成自家格式的轻量 JSON Schema（支持 array items 等嵌套） */
export type ToolSchemaProperty =
    | { type: string; description?: string }
    | {
          type: string;
          description?: string;
          items?: ToolSchemaProperty;
          properties?: Record<string, ToolSchemaProperty>;
      };

/** 与具体 API 无关的工具描述，供各 Provider 转成自家格式 */
export type ToolSchema = {
    name: string;
    description: string;
    parameters?: {
        type: "object";
        properties?: Record<string, ToolSchemaProperty>;
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
     * callOpts：signal 取消请求；onAssistantTextDelta 流式正文增量（智谱等实现）。
     */
    chatWithTools?(
        messages: AgentMessage[],
        tools: ToolSchema[],
        callOpts?: { signal?: AbortSignal; onAssistantTextDelta?: (chunk: string) => void },
    ): Promise<ChatWithToolsResult>;
}