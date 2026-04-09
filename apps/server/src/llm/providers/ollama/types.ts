export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** 请求中的消息：支持 assistant 带 tool_calls、role=tool 的工具结果 */
export type OllamaRequestMessage =
  | { role: "system" | "user"; content: string }
  | {
    role: "assistant";
    content: string;
    tool_calls?: Array<{
      type: "function";
      function: { index?: number; name: string; arguments: Record<string, unknown> };
    }>;
  }
  | { role: "tool"; tool_name: string; content: string };

/** Ollama 要求的工具定义格式 */
export type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
};

export type OllamaChatRequest = {
  model: string;
  messages: OllamaRequestMessage[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  num_predict?: number;
  tools?: OllamaTool[];
};

export type OllamaChatResponseMessage = {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    type: "function";
    function: {
      index?: number;
      name: string;
      arguments?: Record<string, unknown> | string;
    };
  }>;
};

export type OllamaChatResponse = {
  message?: OllamaChatResponseMessage;
  error?: string;
};