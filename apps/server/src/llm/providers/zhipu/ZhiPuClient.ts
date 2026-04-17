import { postJson } from "@/infra/http/ollamaHttpClient";
import { zhipuConfig } from "@/config/evn";
import type {
    ZhiPuChatRequest,
    ZhiPuChatResponse,
    ZhiPuRequestMessage,
    ZhiPuTool,
} from "./types";
import type { AgentMessage, ChatMessage, ToolSchema } from "../ModelProvider";

/**
 * 【修正】构建智谱 API 专用的请求载荷
 */
export function buildZhiPuChatRequest(
    messages: ChatMessage[],
    overrides?: Partial<{ stream: boolean; temperature: number; num_predict: number; thinking: { enable: boolean } }>
): ZhiPuChatRequest {
    // 💡 关键：在构建 Request 之前，必须先将通用 ChatMessage 转换为智谱专用格式
    const zhipuMsgs = toZhiPuMessages(messages);

    return {
        model: zhipuConfig.modelName,
        messages: zhipuMsgs, // 现在类型匹配了：ZhiPuRequestMessage[]
        stream: overrides?.stream ?? zhipuConfig.stream,
        temperature: overrides?.temperature ?? zhipuConfig.temperature,
        top_p: zhipuConfig.topP,
        thinking: overrides?.thinking ?? zhipuConfig.thinking,
    };
}

/**
 * 【修正】协议转换器
 * 确保每一个分支返回的都是 ZhiPuRequestMessage 的合法子类型
 */
export function toZhiPuMessages(messages: AgentMessage[]): ZhiPuRequestMessage[] {
    return messages.map((m): ZhiPuRequestMessage => {

        // 1. 处理工具角色
        if (m.role === "tool") {
            return {
                role: "tool",
                content: String(m.content || ""),
                tool_call_id: String((m as any).tool_call_id || (m as any).id || "call_id"),
            };
        }

        // 2. 处理助手角色
        if (m.role === "assistant") {
            const res: { role: "assistant"; content: string; tool_calls?: any[] } = {
                role: "assistant",
                content: m.content || "",
            };

            if ("tool_calls" in m && m.tool_calls && m.tool_calls.length > 0) {
                // 💡 修复点：通过解构或 as any 统一提取 name 和 arguments
                res.tool_calls = m.tool_calls.map((tc: any) => {
                    // 兼容业务层结构 (tc.name) 和 协议层结构 (tc.function.name)
                    const name = tc.name || tc.function?.name || "";
                    const args = tc.args || tc.function?.arguments || "{}";
                    
                    return {
                        id: tc.id || `call_${Date.now()}`,
                        type: "function" as const,
                        function: {
                            name: name,
                            arguments: typeof args === "string" ? args : JSON.stringify(args),
                        },
                    };
                });
            }
            return res as ZhiPuRequestMessage;
        }

        // 3. 处理用户和系统角色
        if (m.role === "system") {
            return { role: "system", content: m.content };
        }

        return { role: "user", content: m.content };
    });
}


/**
 * 基础聊天接口
 */
export async function chatWithZhiPu(messages: ChatMessage[]): Promise<string> {
    // 自动通过 buildZhiPuChatRequest 调用 toZhiPuMessages 进行转换
    const body = buildZhiPuChatRequest(messages, { stream: false });
    const url = `${zhipuConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;
    
    const data = await postJson<ZhiPuChatResponse>(url, body, {
        timeoutMs: 120_000,
        headers: {
            "Authorization": `Bearer ${zhipuConfig.apiKey}`,
            "Content-Type": "application/json"
        }
    });

    if (data?.error) {
        throw new Error(`智谱 API 错误: ${JSON.stringify(data.error)}`);
    }
    return data?.choices?.[0]?.message?.content ?? "";
}

/** 
 * 结构转换器
 */
export function toZhiPuTools(schemas: ToolSchema[]): ZhiPuTool[] {
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
 * 高级接口：带工具调用的智谱交互
 */
export async function chatWithZhiPuWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[]
): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }> {
    const validMessages = messages.filter(m => m.content && m.content.trim() !== "");
    const url = `${zhipuConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;

    // 统一使用转换器
    const zhipuMessages = toZhiPuMessages(validMessages);
    const zhipuTools = toZhiPuTools(tools);

    const body = {
        model: zhipuConfig.modelName,
        messages: zhipuMessages,
        tools: zhipuTools,
        stream: false,
        temperature: zhipuConfig.temperature,
    };

    const data = await postJson<any>(url, body, {
        timeoutMs: 120_000,
        headers: {
            "Authorization": `Bearer ${zhipuConfig.apiKey}`
        }
    });

    if (data?.error) {
        throw new Error(`智谱交互失败: ${JSON.stringify(data.error)}`);
    }

    const responseMsg = data?.choices?.[0]?.message;
    const rawCalls = responseMsg?.tool_calls ?? [];

    const toolCalls = rawCalls.map((tc: any) => ({
        name: tc.function?.name ?? "",
        args: typeof tc.function?.arguments === "string" 
            ? JSON.parse(tc.function.arguments) 
            : tc.function?.arguments ?? {},
        id: tc.id
    }));

    return { content: responseMsg?.content ?? "", toolCalls };
}
