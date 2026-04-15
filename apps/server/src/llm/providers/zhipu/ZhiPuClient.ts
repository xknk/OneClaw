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
 * 构建智谱 API 专用的请求载荷 (Payload)
 * 适配点：智谱不支持 top_k、repeat_penalty，且 num_predict 对应 max_tokens
 */
export function buildZhiPuChatRequest(
    messages: ChatMessage[],
    overrides?: Partial<{ stream: boolean; temperature: number; num_predict: number; thinking: { enable: boolean } }>
): ZhiPuChatRequest { // 此处返回类型改为 any 或 智谱对应的 Request 类型
    return {
        model: zhipuConfig.modelName,
        messages,
        stream: overrides?.stream ?? zhipuConfig.stream,
        temperature: overrides?.temperature ?? zhipuConfig.temperature,
        top_p: zhipuConfig.topP,
        thinking: overrides?.thinking ?? zhipuConfig.thinking,
        // timeout: zhipuConfig.timeout,
    };
}

/**
 * 基础聊天接口
 * 适配点：修改 URL、注入 Authorization Header、更改取值路径为 choices[0].message
 */
export async function chatWithZhiPu(messages: ChatMessage[]): Promise<string> {
    const body = buildZhiPuChatRequest(messages, { stream: false });
    // 智谱 API 路径
    const url = `${zhipuConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;
    // 必须传入 API Key，且智谱响应结构在 choices 中
    const data = await postJson<ZhiPuChatResponse>(url, body, {
        timeoutMs: 120_000,
        headers: {
            "Authorization": `Bearer ${zhipuConfig.apiKey}`, // 从配置中读取 Key
            "Content-Type": "application/json"
        }
    });

    if (data?.error) {
        throw new Error(`智谱 API 错误: ${JSON.stringify(data.error)}`);
    }
    console.log("智谱API返回数据：", data);
    // 适配点：智谱结果在 choices[0].message.content
    return data?.choices?.[0]?.message?.content ?? "";
}

/** 
 * 协议转换器
 * 适配点：智谱在处理 tool/assistant 角色时需要 tool_call_id 和具体的 ID 字段
 */
export function toZhiPuMessages(messages: AgentMessage[]): ZhiPuRequestMessage[] {
    // 💡 明确标注 map 的返回类型为 ZhiPuRequestMessage
    return messages.map((m): ZhiPuRequestMessage => {

        // 1. 处理工具结果 (role: "tool")
        if (m.role === "tool") {
            return {
                role: "tool" as const, // 👈 必须加 as const 锁定字面量
                content: String(m.content || ""),
                // 确保 ID 存在且为字符串
                tool_call_id: String((m as any).tool_call_id || (m as any).id || "call_id"),
            };
        }

        // 2. 处理助手角色 (role: "assistant")
        if (m.role === "assistant") {
            const hasTools = "tool_calls" in m && m.tool_calls?.length;

            // 构造基础助手消息
            const assistantMsg = {
                role: "assistant" as const,
                content: m.content || "",
            } as any;

            if (hasTools) {
                assistantMsg.tool_calls = m.tool_calls.map((tc: any, i: number) => ({
                    id: tc.id || `call_${Date.now()}_${i}`,
                    type: "function" as const,
                    function: {
                        name: tc.name,
                        // 智谱 API 建议 arguments 传 string 格式
                        arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
                    },
                }));
            }
            return assistantMsg;
        }

        // 3. 处理标准角色 (role: "user" | "system")
        // 使用类型断言匹配联合类型中的特定分支
        return {
            role: m.role as "user" | "system",
            content: (m as any).content || "",
        };
    });
}


/** 
 * 结构转换器
 * 适配点：保持不变，智谱完美兼容此格式
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
    const validMessages: AgentMessage[] = messages.filter(m => m.content && m.content.trim() !== "");

    // 现在这一行应该能正常打印了
    const url = `${zhipuConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const ZhiPuMessages = toZhiPuMessages(validMessages);
    const ZhiPuTools = toZhiPuTools(tools);

    // 过滤出基础消息用于构建 body
    const simpleMessages: ChatMessage[] = ZhiPuMessages
        .filter((m): m is { role: "system" | "user" | "assistant"; content: string } => m.role !== "tool")
        .map((m) => ({ role: m.role, content: m.content }));

    const baseBody = buildZhiPuChatRequest(simpleMessages, { stream: false });

    const body = {
        ...baseBody,
        messages: ZhiPuMessages, // 使用转换后的完整消息
        tools: ZhiPuTools,
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
    const content = responseMsg?.content ?? "";
    const rawCalls = responseMsg?.tool_calls ?? [];

    const toolCalls = rawCalls.map((tc: any) => {
        const name = tc.function?.name ?? "";
        let args = tc.function?.arguments;

        // 智谱 API 始终返回字符串，需要 JSON.parse
        if (typeof args === "string") {
            try {
                args = JSON.parse(args) as Record<string, unknown>;
            } catch {
                args = {};
            }
        }

        if (typeof args !== "object" || args === null) args = {};
        return {
            name,
            args: args as Record<string, unknown>,
            id: tc.id // 传回 ID，这对于智谱后续的工具结果反馈至关重要
        };
    });

    return { content, toolCalls };
}
