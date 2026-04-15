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
 * 构建 Ollama API 专用的请求载荷 (Payload)
 * 作用：将全局环境变量中的模型超参数（Temperature, Top_P 等）与当前消息流合并。
 * @param messages 经过格式化后的消息列表
 * @param overrides 允许在调用处临时覆盖配置（例如：对话时需要随机度，但执行任务时需要确定性）
 */
export function buildOllamaChatRequest(
    messages: ChatMessage[],
    overrides?: Partial<{ stream: boolean; temperature: number; num_predict: number }>
): OllamaChatRequest {
    return {
        model: ollamaConfig.modelName, // 对应 ollama list 中的模型名
        messages,
        // 逻辑回退：优先用参数 -> 其次用配置 -> 最后隐含 API 默认值
        stream: overrides?.stream ?? ollamaConfig.stream,
        temperature: overrides?.temperature ?? ollamaConfig.temperature,
        top_p: ollamaConfig.topP,
        top_k: ollamaConfig.topK,
        repeat_penalty: ollamaConfig.repeatPenalty,
        num_predict: overrides?.num_predict ?? ollamaConfig.numPredict, // 限制模型最大生成的 Token 数
    };
}

/**
 * 基础聊天接口（无工具支持）
 * 场景：用于简单的问答，不触发任何外部函数调用。
 */
export async function chatWithOllama(messages: ChatMessage[]): Promise<string> {
    const body = buildOllamaChatRequest(messages, { stream: false });
    // 兼容性处理：防止 baseUrl 末尾带斜杠导致拼接出 //api/chat 的双斜杠错误
    const url = `${ollamaConfig.baseUrl.replace(/\/$/, "")}/api/chat`;
    
    // 发送 POST 请求，超时设为 120s 是因为本地显存加载模型或推理长文本时可能响应较慢
    const data = await postJson<OllamaChatResponse>(url, body, { timeoutMs: 120_000 });
    
    if (data?.error) {
        throw new Error(`Ollama 内部错误: ${data.error}`);
    }
    // Ollama 的非流式响应中，内容位于 message.content
    return data?.message?.content ?? "";
}

/** 
 * 协议转换器：将通用 AgentMessage 转换为 Ollama 要求的消息协议
 * 核心逻辑：
 * 1. 处理 'tool' 角色：将工具执行后的结果反馈给模型。
 * 2. 处理 'assistant' 的工具调用：将模型之前的思考（tool_calls）写回上下文，否则模型会“忘记”它刚才叫你干什么。
 */
export function toOllamaMessages(messages: AgentMessage[]): OllamaRequestMessage[] {
    return messages.map((m) => {
        // 情况 A: 这一条是工具返回的结果
        if (m.role === "tool" && "tool_name" in m) {
            return { role: "tool", tool_name: m.tool_name, content: m.content };
        }
        // 情况 B: 这一条是模型发出的调用指令
        if (m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length) {
            return {
                role: "assistant",
                content: m.content,
                // Ollama 要求的 tool_calls 格式：必须包含 type: 'function' 和嵌套的 function 对象
                tool_calls: m.tool_calls.map((tc, i) => ({
                    type: "function" as const,
                    function: { 
                        index: i, // 某些本地模型依赖索引来匹配响应
                        name: tc.name, 
                        arguments: tc.args 
                    },
                })),
            };
        }
        // 情况 C: 标准的角色消息 (user/system/assistant 无工具)
        return { role: m.role, content: (m as { content: string }).content };
    });
}

/** 
 * 结构转换器：将内部 ToolSchema (定义) 转换为 Ollama API 识别的 tools 声明
 * 作用：让模型知道有哪些“技能”可以使用，以及参数的 JSON Schema 约束。
 */
export function toOllamaTools(schemas: ToolSchema[]): OllamaTool[] {
    return schemas.map((s) => ({
        type: "function",
        function: {
            name: s.name,
            description: s.description,
            // 必须符合 JSON Schema 规范，若未定义参数则默认为空对象
            parameters: s.parameters ?? { type: "object", properties: {} },
        },
    }));
}

/**
 * 高级接口：带工具调用的 Ollama 交互
 * 实现细节：
 * 1. 同时发送历史消息 (messages) 和可用工具列表 (tools)。
 * 2. 解析模型返回的 content（它的思考过程）和 tool_calls（它的行动计划）。
 */
export async function chatWithOllamaWithTools(
    messages: AgentMessage[],
    tools: ToolSchema[]
): Promise<{ content: string; toolCalls: Array<{ name: string; args: Record<string, unknown> }> }> {
    const url = `${ollamaConfig.baseUrl.replace(/\/$/, "")}/api/chat`;
    
    // 1. 转换消息格式以包含之前的工具交互历史
    const ollamaMessages = toOllamaMessages(messages);
    // 2. 转换工具声明，告诉模型你可以调用什么
    const ollamaTools = toOllamaTools(tools);
    
    // 3. 构建临时消息快照用于基础参数初始化
    const simpleMessages: ChatMessage[] = ollamaMessages
        .filter((m): m is { role: "system" | "user" | "assistant"; content: string } => m.role !== "tool")
        .map((m) => ({ role: m.role, content: m.content }));
    
    const baseBody = buildOllamaChatRequest(simpleMessages, { stream: false });
    
    // 4. 组合最终请求体，明确要求模型进行工具检测
    const body: OllamaChatRequest = {
        ...baseBody,
        messages: ollamaMessages,
        tools: ollamaTools,
    };

    const data = await postJson<OllamaChatResponse>(url, body, { timeoutMs: 120_000 });
    
    if (data?.error) {
        throw new Error(`Ollama 交互失败: ${data.error}`);
    }

    const content = data?.message?.content ?? "";
    const rawCalls = data?.message?.tool_calls ?? [];

    /**
     * 5. 健壮性解析 (Robust Parsing)：
     * 重点：本地模型（如 Llama3/Qwen2）在返回工具参数时，
     * 有时会错误地返回 JSON 字符串而非 JSON 对象。此处做了强制兼容。
     */
    const toolCalls = rawCalls.map((tc) => {
        const name = tc.function?.name ?? "";
        let args = tc.function?.arguments;
        
        // 如果模型“偷懒”返回了字符串，尝试手动解析
        if (typeof args === "string") {
            try {
                args = JSON.parse(args) as Record<string, unknown>;
            } catch {
                console.warn(`无法解析模型生成的参数字符串: ${args}`);
                args = {};
            }
        }
        
        // 兜底：确保 args 最终一定是个对象，防止上层 Agent 崩溃
        if (typeof args !== "object" || args === null) args = {};
        return { name, args: args as Record<string, unknown> };
    });

    return { content, toolCalls };
}
