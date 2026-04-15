export type ZhiPuChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** 
 * 修正点：将 tool_call_id 改为 tool_calls
 * 修正点：智谱线上 API 的 arguments 通常要求是 string (JSON序列化后)
 */
export type ZhiPuRequestMessage =

  | { role: "system" | "user"; content: string }
  | { role: "tool"; content: string; tool_call_id: string } // tool 角色必须有 id

  | {
    role: "assistant";
    content: string;
    tool_calls?: Array<{ // 👈 必须是 tool_calls
      id: string;        // 👈 线上 API 必须有 id
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };

/** ZhiPu 要求的工具定义格式 (保持现状即可) */
export type ZhiPuTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, any>;
      required?: string[];
    };
  };
};

export type ZhiPuChatRequest = {
  model: string;
  messages: ZhiPuRequestMessage[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  tools?: ZhiPuTool[];
  thinking?: { enable: boolean };
  // 注意：智谱 API 实际上使用 max_tokens 而不是 num_predict
  max_tokens?: number;
};

/** 
 * 修正响应结构：智谱返回的是 choices 数组，
 * 且 message 内部可能包含 content 或 tool_calls
 */
export type ZhiPuChatResponse = {
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string; // 线上返回的是字符串，需要 JSON.parse
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: any;
};
