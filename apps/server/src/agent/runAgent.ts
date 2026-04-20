/**
 * Agent 核心控制器
 *
 * 核心逻辑：ReAct (Reasoning and Acting) 模式。
 * 1. 推理 (Reason)：将对话历史发给 LLM，询问“下一步该做什么”。
 * 2. 行动 (Act)：如果 LLM 决定调用工具，执行该工具并获取结果。
 * 3. 循环 (Loop)：将结果反馈给 LLM，开启下一轮推理，直到任务完成。
 */

import type {
    ChatMessage,
    AgentMessage,
    ToolSchema,
    ChatWithToolsResult,
} from "@/llm/providers/ModelProvider";
import { chatWithModelWithTools, resolveFallbackModelKey } from "@/llm/model";
import { getTool, getToolSchemas } from "./tools/index";
import type { ToolGuardResult } from "@/security/toolGuard";
import { normalizeToolGuardResult } from "@/security/toolGuard";

const MAX_TOOL_ROUNDS = 5;

type executeTool = (toolName: string, args: Record<string, unknown> | undefined) => Promise<string>;

function isToolFailureResultString(result: string): boolean {
    return (
        result.startsWith("错误：") ||
        result.startsWith("无权限：") ||
        result.startsWith("参数错误：") ||
        result.startsWith("工具执行失败:") ||
        result.startsWith("工具执行异常:") ||
        result.startsWith("策略拒绝：") ||
        result.startsWith("策略拒绝:")
    );
}

function formatExecuteToolException(err: unknown): string {
    if (err instanceof Error) {
        if (err.name === "ToolPolicyError") {
            return `策略拒绝：${err.message}`;
        }
        return `工具执行异常: ${err.message}`;
    }
    return `工具执行异常: ${String(err)}`;
}

function isAbortLike(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.name === "AbortError") return true;
    return /aborted|AbortError/i.test(err.message);
}

export interface RunAgentOptions {
    maxToolRounds?: number;
    toolSchemas?: ToolSchema[];
    toolGuard?: (
        toolName: string,
        args: Record<string, unknown> | undefined
    ) => string | null | ToolGuardResult;
    onToolCallFinished?: (event: {
        toolName: string;
        args: Record<string, unknown> | undefined;
        result: string;
        ok: boolean;
        durationMs: number;
    }) => Promise<void> | void;
    executeTool?: executeTool;
    onModelEvent?: (
        event:
            | { type: "llm.request"; round: number; contentLength?: number }
            | {
                  type: "llm.response";
                  round: number;
                  toolCallCount?: number;
                  contentLength?: number;
              }
            | { type: "llm.error"; round: number; error: string }
    ) => Promise<void> | void;
    modelType?: string;
    /** 取消：断开连接或前端停止时中止 LLM/工具 */
    abortSignal?: AbortSignal;
    /** 流式 assistant 正文增量（由 Provider 支持时生效） */
    onAssistantTextDelta?: (chunk: string) => void;
    /** 按 ReAct 轮次切换工具表（如首轮去掉 MCP） */
    resolveToolSchemas?: (toolRound: number) => ToolSchema[];
    /** 来自注册表的 riskLevel===low 判定，可并行且可分段并行执行 */
    toolParallelSafe?: (toolName: string) => boolean;
}

async function callLlmWithOptionalFallback(
    agentMessages: AgentMessage[],
    schemas: ToolSchema[],
    primaryModel: string,
    callOpts: { signal?: AbortSignal; onAssistantTextDelta?: (chunk: string) => void },
): Promise<ChatWithToolsResult> {
    try {
        return await chatWithModelWithTools(agentMessages, schemas, primaryModel, callOpts);
    } catch (err) {
        if (callOpts.signal?.aborted || isAbortLike(err)) {
            throw err;
        }
        const fb = resolveFallbackModelKey();
        if (!fb || fb === primaryModel) {
            throw err;
        }
        return chatWithModelWithTools(agentMessages, schemas, fb, callOpts);
    }
}

/**
 * 连续的低风险工具段并行执行，其后串行（optimize §1 / §9）
 */
async function executeToolCallsBatched(
    normalizedToolCalls: ChatWithToolsResult["toolCalls"],
    options: RunAgentOptions | undefined,
    agentMessages: AgentMessage[],
): Promise<void> {
    const isSafe = (name: string) => options?.toolParallelSafe?.(name) === true;
    let i = 0;
    while (i < normalizedToolCalls.length) {
        if (options?.abortSignal?.aborted) {
            agentMessages.push({
                role: "tool",
                tool_name: normalizedToolCalls[i]!.name,
                content: "（已中止）",
                tool_call_id: String(normalizedToolCalls[i]!.id ?? ""),
            });
            i++;
            continue;
        }

        if (!isSafe(normalizedToolCalls[i]!.name)) {
            agentMessages.push(await executeAndRecordTool(normalizedToolCalls[i]!, options));
            i++;
            continue;
        }

        let j = i + 1;
        while (j < normalizedToolCalls.length && isSafe(normalizedToolCalls[j]!.name)) {
            j++;
        }
        const batch = normalizedToolCalls.slice(i, j);
        if (batch.length === 1) {
            agentMessages.push(await executeAndRecordTool(batch[0]!, options));
        } else {
            const results = await Promise.all(batch.map((c) => executeAndRecordTool(c, options)));
            agentMessages.push(...results);
        }
        i = j;
    }
}

export async function runAgent(messages: ChatMessage[], options?: RunAgentOptions): Promise<string> {
    const maxRounds = options?.maxToolRounds ?? MAX_TOOL_ROUNDS;
    const baseToolSchemas = options?.toolSchemas ?? getToolSchemas();
    const modelType = options?.modelType?.trim() ? options.modelType.trim() : "zhipu";

    const agentMessages: AgentMessage[] = [...messages];
    let round = 0;
    let lastContent = "";

    while (round < maxRounds) {
        round++;

        if (options?.abortSignal?.aborted) {
            return lastContent || "（已中止）";
        }

        await options?.onModelEvent?.({
            type: "llm.request",
            round,
            contentLength: agentMessages.length,
        });

        const schemasThisRound = options?.resolveToolSchemas?.(round) ?? baseToolSchemas;
        const callOpts = {
            signal: options?.abortSignal,
            onAssistantTextDelta: options?.onAssistantTextDelta,
        };

        let content: string;
        let toolCalls: ChatWithToolsResult["toolCalls"];

        try {
            const r = await callLlmWithOptionalFallback(
                agentMessages,
                schemasThisRound,
                modelType,
                callOpts,
            );
            content = r.content;
            toolCalls = r.toolCalls;
        } catch (err) {
            if (options?.abortSignal?.aborted || isAbortLike(err)) {
                return lastContent || "（已中止）";
            }
            const msg = err instanceof Error ? err.message : String(err);
            await options?.onModelEvent?.({ type: "llm.error", round, error: msg });
            return `模型请求失败：${msg}`;
        }

        lastContent = content;

        await options?.onModelEvent?.({
            type: "llm.response",
            round,
            toolCallCount: toolCalls.length,
            contentLength: content?.length ?? 0,
        });

        if (toolCalls.length === 0) return content || lastContent;

        const normalizedToolCalls = toolCalls.map((tc, idx) => ({
            ...tc,
            id:
                tc.id && String(tc.id).trim()
                    ? String(tc.id).trim()
                    : `call_${Date.now()}_${round}_${idx}`,
        }));

        agentMessages.push({
            role: "assistant",
            content,
            tool_calls: normalizedToolCalls.map((tc) => ({
                id: tc.id!,
                name: tc.name,
                args: tc.args,
            })),
        });

        if (options?.toolParallelSafe) {
            await executeToolCallsBatched(normalizedToolCalls, options, agentMessages);
        } else {
            for (const call of normalizedToolCalls) {
                if (options?.abortSignal?.aborted) {
                    agentMessages.push({
                        role: "tool",
                        tool_name: call.name,
                        content: "（已中止）",
                        tool_call_id: String(call.id ?? ""),
                    });
                    continue;
                }
                agentMessages.push(await executeAndRecordTool(call, options));
            }
        }
    }

    return lastContent;
}

async function executeAndRecordTool(
    call: ChatWithToolsResult["toolCalls"][0],
    options?: RunAgentOptions,
): Promise<AgentMessage> {
    const startedAt = Date.now();
    let result: string;

    if (options?.abortSignal?.aborted) {
        result = "（已中止）";
    } else {
        try {
            result = await executeSingleTool(call.name, call.args, {
                executeTool: options?.executeTool,
                toolGuard: options?.toolGuard,
            });
        } catch (err) {
            result = `工具执行错误: ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    const durationMs = Date.now() - startedAt;

    options?.onToolCallFinished?.({
        toolName: call.name,
        args: call.args,
        result,
        ok: !isToolFailureResultString(result) && result !== "（已中止）",
        durationMs,
    });

    return {
        role: "tool",
        tool_name: call.name,
        content: result,
        tool_call_id: String(call.id ?? ""),
    };
}

async function executeSingleTool(
    name: string,
    args: Record<string, unknown> | undefined,
    hooks: {
        executeTool?: RunAgentOptions["executeTool"];
        toolGuard?: RunAgentOptions["toolGuard"];
    },
): Promise<string> {
    if (hooks.executeTool) {
        try {
            return await hooks.executeTool(name, args);
        } catch (err) {
            return formatExecuteToolException(err);
        }
    }

    let guard: ToolGuardResult;
    try {
        guard = normalizeToolGuardResult(hooks.toolGuard?.(name, args));
    } catch (err) {
        return formatExecuteToolException(err);
    }
    if (!guard.allow) {
        return guard.message;
    }

    const tool = getTool(name);
    if (!tool) {
        return `错误：未知工具 "${name}"`;
    }

    try {
        return await tool.execute(args ?? {});
    } catch (err) {
        return `工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
    }
}
