import { postJson } from "@/infra/http/ollamaHttpClient";
import { zhipuConfig } from "@/config/evn";
import type {
    ZhiPuChatRequest,
    ZhiPuChatResponse,
    ZhiPuRequestMessage,
    ZhiPuTool,
} from "./types";
import type { AgentMessage, ChatMessage, ToolSchema } from "../ModelProvider";
import type { ZhiPuProviderOptions } from "./ZhiPuProvider";

/**
 * 【修正】构建智谱 API 专用的请求载荷
 */
export function buildZhiPuChatRequest(
    messages: ChatMessage[],
    overrides?: Partial<{ stream: boolean; temperature: number; num_predict: number; thinking: { enable: boolean } }>,
    providerOptions?: ZhiPuProviderOptions,
): ZhiPuChatRequest {
    // 💡 关键：在构建 Request 之前，必须先将通用 ChatMessage 转换为智谱专用格式
    const zhipuMsgs = toZhiPuMessages(messages);

    return {
        model: providerOptions?.modelName?.trim() ? providerOptions.modelName.trim() : zhipuConfig.modelName,
        messages: zhipuMsgs, // 现在类型匹配了：ZhiPuRequestMessage[]
        stream: overrides?.stream ?? zhipuConfig.stream,
        temperature: overrides?.temperature ?? providerOptions?.temperature ?? zhipuConfig.temperature,
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


export async function chatWithZhiPu(
    messages: ChatMessage[],
    providerOptions?: ZhiPuProviderOptions,
): Promise<string> {
    const baseUrl = providerOptions?.baseUrl?.trim() ? providerOptions.baseUrl.trim() : zhipuConfig.baseUrl;
    const apiKey = providerOptions?.apiKey?.trim() ? providerOptions.apiKey.trim() : zhipuConfig.apiKey;
    const body = buildZhiPuChatRequest(messages, { stream: false }, providerOptions);
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    const data = await postJson<ZhiPuChatResponse>(url, body, {
        timeoutMs: 120_000,
        headers: {
            "Authorization": `Bearer ${apiKey}`,
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
    tools: ToolSchema[],
    providerOptions?: ZhiPuProviderOptions,
): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }> {
    // 注意：assistant 可能只发 tool_calls 而 content 为空；tool 也可能 content 很短。
    // 不能简单按 content 过滤，否则会破坏 tool_calls/结果配对。
    const validMessages = messages.filter((m: any) => {
        if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) return true;
        if (m.role === "tool") return true;
        return typeof m.content === "string" && m.content.trim() !== "";
    });
    const baseUrl = providerOptions?.baseUrl?.trim() ? providerOptions.baseUrl.trim() : zhipuConfig.baseUrl;
    const apiKey = providerOptions?.apiKey?.trim() ? providerOptions.apiKey.trim() : zhipuConfig.apiKey;
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    // 统一使用转换器
    const zhipuMessages = toZhiPuMessages(validMessages);
    const zhipuTools = toZhiPuTools(tools);

    const body = {
        model: providerOptions?.modelName?.trim() ? providerOptions.modelName.trim() : zhipuConfig.modelName,
        messages: zhipuMessages,
        tools: zhipuTools,
        stream: false,
        temperature: providerOptions?.temperature ?? zhipuConfig.temperature,
    };

    const data = await postJson<any>(url, body, {
        timeoutMs: 120_000,
        headers: {
            "Authorization": `Bearer ${apiKey}`
        }
    });

    if (data?.error) {
        throw new Error(`智谱交互失败: ${JSON.stringify(data.error)}`);
    }

    const responseMsg = data?.choices?.[0]?.message;
    const rawCalls = responseMsg?.tool_calls ?? [];

    const toolCalls = rawCalls.map((tc: any) => {
        const rawArgs = tc.function?.arguments;
        let args: Record<string, unknown> = {};
        if (typeof rawArgs === "string") {
            try {
                const parsed = JSON.parse(rawArgs);
                args = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
            } catch {
                // 智谱偶尔会返回非严格 JSON；兜底为空对象，交由工具侧做参数校验并返回可读错误
                args = {};
            }
        } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
            args = rawArgs;
        }
        return {
            name: tc.function?.name ?? "",
            args,
            id: tc.id,
        };
    });

    return { content: responseMsg?.content ?? "", toolCalls };
}
