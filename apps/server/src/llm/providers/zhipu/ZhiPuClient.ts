import { postJson } from "@/infra/http/ollamaHttpClient";
import { appConfig, zhipuConfig } from "@/config/evn";
import { stripModelThinkingMarkup } from "@/llm/sanitizeModelOutput";
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
        },
        signal: providerOptions?.signal,
    });

    if (data?.error) {
        throw new Error(`智谱 API 错误: ${JSON.stringify(data.error)}`);
    }
    const msg = data?.choices?.[0]?.message as { content?: string | null; reasoning_content?: string | null } | undefined;
    const c = typeof msg?.content === "string" ? msg.content : "";
    const r = typeof msg?.reasoning_content === "string" ? msg.reasoning_content : "";
    return c.trim().length > 0 ? c : r;
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
 * 流式：边收边推送 assistant 文本增量，结束时解析完整 tool_calls（optimize §7 / §9）
 */
async function chatWithZhiPuWithToolsStream(
    messages: AgentMessage[],
    tools: ToolSchema[],
    providerOptions: ZhiPuProviderOptions,
): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }> {
    const onDelta = providerOptions.onAssistantTextDelta;
    const validMessages = messages.filter((m: any) => {
        if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) return true;
        if (m.role === "tool") return true;
        return typeof m.content === "string" && m.content.trim() !== "";
    });
    const baseUrl = providerOptions?.baseUrl?.trim() ? providerOptions.baseUrl.trim() : zhipuConfig.baseUrl;
    const apiKey = providerOptions?.apiKey?.trim() ? providerOptions.apiKey.trim() : zhipuConfig.apiKey;
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const zhipuMessages = toZhiPuMessages(validMessages);
    const zhipuTools = toZhiPuTools(tools);
    const body = {
        model: providerOptions?.modelName?.trim() ? providerOptions.modelName.trim() : zhipuConfig.modelName,
        messages: zhipuMessages,
        tools: zhipuTools,
        stream: true,
        temperature: providerOptions?.temperature ?? zhipuConfig.temperature,
        thinking: zhipuConfig.thinking,
    };

    const controller = new AbortController();
    const timeoutMs = 120_000;
    /** 覆盖「连接建立 + 整段 SSE」：原先只在 fetch 返回后清计时器，流式体半途挂起时会永远卡在 reader.read() */
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onUserAbort = (): void => controller.abort();
    const userSig = providerOptions.signal;
    if (userSig) {
        if (userSig.aborted) controller.abort();
        else userSig.addEventListener("abort", onUserAbort, { once: true });
    }

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(`智谱流式请求失败 ${res.status}: ${errText.slice(0, 500)}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("智谱流式响应无 body");

        const decoder = new TextDecoder();
        let buf = "";
        let contentAcc = "";
        /** GLM-4.5+ 可能只在 delta.reasoning_content 里流式输出思维链，content 较晚或为空；不合并则 TUI 长时间无增量、像卡死 */
        let reasoningAcc = "";
        const toolAgg = new Map<number, { id?: string; name?: string; args: string }>();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                const data = t.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                    const json = JSON.parse(data) as {
                        choices?: Array<{
                            delta?: {
                                content?: string;
                                reasoning_content?: string;
                                tool_calls?: any[];
                            };
                        }>;
                    };
                    const delta = json.choices?.[0]?.delta;
                    if (delta?.content) {
                        contentAcc += delta.content;
                        onDelta?.(delta.content);
                    }
                    const rc = delta?.reasoning_content;
                    if (typeof rc === "string" && rc.length > 0) {
                        reasoningAcc += rc;
                        const piece = stripModelThinkingMarkup(rc);
                        if (piece) onDelta?.(piece);
                    }
                    if (Array.isArray(delta?.tool_calls)) {
                        for (const tc of delta.tool_calls) {
                            const idx = typeof tc.index === "number" ? tc.index : 0;
                            let slot = toolAgg.get(idx);
                            if (!slot) {
                                slot = { args: "" };
                                toolAgg.set(idx, slot);
                            }
                            if (tc.id) slot.id = String(tc.id);
                            if (tc.function?.name) slot.name = String(tc.function.name);
                            if (tc.function?.arguments != null) {
                                slot.args += String(tc.function.arguments);
                            }
                        }
                    }
                } catch {
                    /* 跳过畸形 chunk */
                }
            }
        }

        const toolCalls = [...toolAgg.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => {
                let args: Record<string, unknown> = {};
                const raw = v.args?.trim() ?? "";
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        args =
                            parsed && typeof parsed === "object" && !Array.isArray(parsed)
                                ? (parsed as Record<string, unknown>)
                                : {};
                    } catch {
                        args = {};
                    }
                }
                return { name: v.name ?? "", args, id: v.id };
            })
            .filter((tc) => tc.name);

        const merged =
            contentAcc.trim().length > 0 ? contentAcc : reasoningAcc.trim().length > 0 ? reasoningAcc : "";
        return { content: merged, toolCalls };
    } finally {
        clearTimeout(timeoutId);
        if (userSig) userSig.removeEventListener("abort", onUserAbort);
    }
}

/**
 * 智谱带工具：非流式 JSON 一次性返回（与 Agent/Web 最稳）。
 */
async function chatWithZhiPuWithToolsNonStream(
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
        thinking: zhipuConfig.thinking,
    };

    const data = await postJson<any>(url, body, {
        timeoutMs: 120_000,
        headers: {
            "Authorization": `Bearer ${apiKey}`
        },
        signal: providerOptions?.signal,
    });

    if (data?.error) {
        throw new Error(`智谱交互失败: ${JSON.stringify(data.error)}`);
    }

    const responseMsg = data?.choices?.[0]?.message as
        | {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: any[];
          }
        | undefined;
    const rawCalls = responseMsg?.tool_calls ?? [];
    const rawContent = typeof responseMsg?.content === "string" ? responseMsg.content : "";
    const rawReasoning =
        typeof responseMsg?.reasoning_content === "string" ? responseMsg.reasoning_content : "";
    const visibleText = rawContent.trim().length > 0 ? rawContent : rawReasoning;

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

    return { content: visibleText, toolCalls };
}

export async function chatWithZhiPuWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[],
    providerOptions?: ZhiPuProviderOptions,
): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }> {
    const onDelta = providerOptions?.onAssistantTextDelta;
    const useStreamTools = zhipuConfig.streamTools && !!onDelta;

    if (useStreamTools) {
        return chatWithZhiPuWithToolsStream(messages, tools, providerOptions);
    }

    const aggregated = await chatWithZhiPuWithToolsNonStream(messages, tools, providerOptions);
    const text = aggregated.content ?? "";
    /**
     * 默认非流式：有正文时推 delta；若仅有 tool_calls、正文为空，也必须推一行占位，否则 TUI/Web
     * 在「首轮请求 + 工具执行 + 次轮合成」整段完成前没有任何输出，像死机。
     */
    if (onDelta) {
        if (text.trim()) {
            onDelta(text);
        } else {
            const names = (aggregated.toolCalls ?? [])
                .map((t) => t.name)
                .filter((n): n is string => typeof n === "string" && !!n.trim());
            if (names.length) {
                const join = names.join(", ");
                onDelta(
                    appConfig.uiLocale === "en"
                        ? `[Calling tools: ${join}]\n`
                        : `[调用工具: ${join}]\n`,
                );
            }
        }
    }
    return aggregated;
}
