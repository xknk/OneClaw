import { postJson } from "@/infra/http/ollamaHttpClient";
import { ollamaConfig } from "@/config/evn";
import type {
    OllamaTool,
    OllamaRequestMessage,
    OllamaChatRequest,
    OllamaChatResponse,
} from "./types";
import type { AgentMessage, ChatMessage, ToolSchema } from "../ModelProvider";

/** 
 * 协议转换器：适配 Ollama 专有协议
 * 处理点：角色转换、tool_name 注入、参数格式化
 */
export function toOllamaMessages(messages: AgentMessage[]): OllamaRequestMessage[] {
    return messages.map((m): OllamaRequestMessage => {
        if (m.role === "assistant") {
            const res: any = { role: "assistant", content: m.content || "" };
            
            // 💡 核心：把业务层的扁平结构 (name, args) 翻译成 协议层的嵌套结构 (function: { name, arguments })
            if ("tool_calls" in m && m.tool_calls?.length) {
                res.tool_calls = m.tool_calls.map((tc: any) => ({
                    type: "function",
                    function: {
                        // 兼容多种可能的键名
                        name: tc.name || tc.function?.name,
                        arguments: tc.args || tc.function?.arguments 
                    },
                }));
            }
            return res;
        }
        // ... 处理 system, user, tool 角色 ...
        return { role: m.role, content: m.content } as any;
    });
}


/**
 * 构建 Ollama 请求载荷
 */
export function buildOllamaChatRequest(
    messages: AgentMessage[],
    overrides?: Partial<{ stream: boolean; temperature: number; num_predict: number }>
): OllamaChatRequest {
    return {
        model: ollamaConfig.modelName,
        messages: toOllamaMessages(messages),
        stream: overrides?.stream ?? ollamaConfig.stream,
        options: {
            temperature: overrides?.temperature ?? ollamaConfig.temperature,
            top_p: ollamaConfig.topP,
            top_k: ollamaConfig.topK,
            num_predict: overrides?.num_predict ?? ollamaConfig.numPredict,
        }
    } as OllamaChatRequest;
}

/**
 * 基础对话接口
 * 修正：参数类型改为 AgentMessage[] 或 any[]，以兼容业务层的复杂消息结构
 */
export async function chatWithOllama(messages: AgentMessage[] | ChatMessage[]): Promise<string> {
    // 强制转换为合法的 Ollama 协议格式
    const ollamaMsgs = toOllamaMessages(messages as AgentMessage[]);
    
    const body = buildOllamaChatRequest(ollamaMsgs as any, { stream: false });
    const url = `${ollamaConfig.baseUrl.replace(/\/$/, "")}/api/chat`;
    const data = await postJson<OllamaChatResponse>(url, body, { timeoutMs: 120_000 });
    
    if (data?.error) throw new Error(`Ollama 错误: ${data.error}`);
    return data?.message?.content ?? "";
}

/** 
 * 工具定义转换器
 */
export function toOllamaTools(schemas: ToolSchema[]): OllamaTool[] {
    return schemas.map((s) => ({
        type: "function",
        function: {
            name: s.name,
            description: s.description,
            parameters: s.parameters ?? { type: "object", properties: {} },
        },
    }));
}

/**
 * 【恢复】高级接口：带工具调用的 Ollama 交互
 * 包含健壮性参数解析逻辑
 */
export async function chatWithOllamaWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[]
): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }> {
    const url = `${ollamaConfig.baseUrl.replace(/\/$/, "")}/api/chat`;
    
    // 调用转换器将 AgentMessage 转化为 OllamaRequestMessage
    const ollamaMessages = toOllamaMessages(messages);
    const ollamaTools = toOllamaTools(tools);
    
    // 2. 构建请求体 (复用配置参数)
    const baseBody = buildOllamaChatRequest(messages, { stream: false });
    const body = {
        ...baseBody,
        messages: ollamaMessages,
        tools: ollamaTools,
    };

    const data = await postJson<OllamaChatResponse>(url, body, { timeoutMs: 120_000 });
    
    if (data?.error) {
        throw new Error(`Ollama 工具交互失败: ${data.error}`);
    }

    const message = data?.message;
    const content = message?.content ?? "";
    const rawCalls = message?.tool_calls ?? [];

    // 3. 健壮性解析：处理模型可能返回的字符串格式参数
    const toolCalls = rawCalls.map((tc: any) => {
        const name = tc.function?.name ?? "";
        let args = tc.function?.arguments ?? {};
        
        if (typeof args === "string") {
            try {
                args = JSON.parse(args);
            } catch {
                console.warn(`[Ollama] 无法解析参数字符串: ${args}`);
                args = {};
            }
        }
        
        return { 
            name, 
            args: args as Record<string, unknown>,
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 5)}` // 确保生成 ID 供后续逻辑追溯
        };
    });

    return { content, toolCalls };
}
