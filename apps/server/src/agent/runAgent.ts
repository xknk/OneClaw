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
import { chatWithModelWithTools, chatWithModel } from "@/llm/model";
import { getTool, getToolSchemas } from "./tools/index";
import type { ToolGuardResult } from "@/security/toolGuard";
import { normalizeToolGuardResult } from "@/security/toolGuard";

/**
 * 默认最大迭代轮数。
 * 作用：防止 LLM 陷入逻辑死循环（例如：工具报错 -> LLM 重试 -> 工具又报错）导致 Token 消耗失控。
 */
const MAX_TOOL_ROUNDS = 5;

/**
 * 定义工具执行器的类型签名
 */
type executeTool = (toolName: string, args: Record<string, unknown> | undefined) => Promise<string>;

/** 与 ToolExecutionService、chatProcessing 等返回文案对齐，用于判断 tool 轮次是否应视为失败 */
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

/**
 * 自定义 executeTool 抛错时转为模型可读的 observation，避免整轮 ReAct 中断。
 */
function formatExecuteToolException(err: unknown): string {
    if (err instanceof Error) {
        if (err.name === "ToolPolicyError") {
            return `策略拒绝：${err.message}`;
        }
        return `工具执行异常: ${err.message}`;
    }
    return `工具执行异常: ${String(err)}`;
}

/**
 * Agent 运行配置选项
 */
export interface RunAgentOptions {
    /** 最大迭代轮数，默认 5 */
    maxToolRounds?: number;
    /** 可选：手动传入工具定义，若不传则从全局 getToolSchemas 获取 */
    toolSchemas?: ToolSchema[];
    /**
     * 工具执行前权限校验钩子。
     * 返回 null 表示放行；返回 string 为拒绝文案；
     * 也可返回完整的 ToolGuardResult 包含错误码和元数据。
     */
    toolGuard?: (
        toolName: string,
        args: Record<string, unknown> | undefined
    ) => string | null | ToolGuardResult;
    /** 工具调用完成后的回调（无论成功失败），常用于审计日志或埋点 */
    onToolCallFinished?: (event: {
        toolName: string;
        args: Record<string, unknown> | undefined;
        result: string;
        ok: boolean;
        durationMs: number;
    }) => Promise<void> | void;
    /** 自定义工具执行逻辑，若提供则绕过本地 getTool 执行逻辑 */
    executeTool?: executeTool;
    /** 模型生命周期事件通知，可用于前端展示进度条或 Token 计算 */
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
}

/**
 * runAgent: 执行 Agent 任务的核心入口
 *
 * @param messages 初始对话历史
 * @param options 控制参数（工具 schema、executeTool、guard 等）
 */
/** 允许并行的工具白名单：无副作用且无相互依赖的只读操作 */
const PARALLEL_TOOL_WHITELIST = new Set([
    "get_time",
    "echo",
    "json_validate",
    "fetch_url",
    "list_directory",
    "read_file",
    "search_files"
]);

export async function runAgent(
    messages: ChatMessage[],
    options?: RunAgentOptions
): Promise<string> {
    const maxRounds = options?.maxToolRounds ?? MAX_TOOL_ROUNDS;
    let toolSchemas = options?.toolSchemas ?? getToolSchemas();

    const agentMessages: AgentMessage[] = [...messages];
    let round = 0;
    let lastContent = "";
    
    // --- 策略降级控制变量 ---
    // let attemptWithFallback = true;
    // let useStrictMode = true; 

    while (round < maxRounds) {
        round++;

        await options?.onModelEvent?.({
            type: "llm.request",
            round,
            contentLength: agentMessages.length,
        });

        // 1. 调用模型（带降级逻辑尝试）
        let content: string;
        let toolCalls: ChatWithToolsResult["toolCalls"];
        
        try {
            const r = await chatWithModelWithTools(agentMessages, toolSchemas);
            content = r.content;
            toolCalls = r.toolCalls;
        } catch (err) {
            // 这里可以触发模型切换或 Prompt 简化的降级逻辑
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

        // 2. 记录助手意图
        agentMessages.push({
            role: "assistant",
            content,
            tool_calls: toolCalls.map((tc) => ({ id: tc.id ?? "", name: tc.name, args: tc.args })),
        });

        // 3. 决定执行策略：检查是否本轮所有工具都在并行白名单内
        const canParallel = toolCalls.length > 1 && toolCalls.every(call => PARALLEL_TOOL_WHITELIST.has(call.name));

        if (canParallel) {
            // --- 并行执行模式 ---
            const results = await Promise.all(
                toolCalls.map(call => executeAndRecordTool(call, options))
            );
            agentMessages.push(...results);
        } else {
            // --- 串行执行模式 (含敏感操作如 apply_patch, exec) ---
            for (const call of toolCalls) {
                const result = await executeAndRecordTool(call, options);
                agentMessages.push(result);
            }
        }
    }

    return lastContent;
}

/**
 * 辅助函数：执行单个工具并记录事件，封装成标准的 AgentMessage 格式
 */
async function executeAndRecordTool(
    call: ChatWithToolsResult["toolCalls"][0],
    options?: RunAgentOptions
): Promise<AgentMessage> {
    const startedAt = Date.now();
    let result: string;

    try {
        result = await executeSingleTool(call.name, call.args, {
            executeTool: options?.executeTool,
            toolGuard: options?.toolGuard,
        });
    } catch (err) {
        result = `工具执行错误: ${err instanceof Error ? err.message : String(err)}`;
    }

    const durationMs = Date.now() - startedAt;

    options?.onToolCallFinished?.({
        toolName: call.name,
        args: call.args,
        result,
        ok: !isToolFailureResultString(result),
        durationMs,
    });

    return {
        role: "tool",
        tool_name: call.name,
        content: result,
        tool_call_id: call.id, // 确保 ID 传递正确
    };
}


/**
 * executeSingleTool: 执行单个工具的封装函数
 * 
 * 包含：权限守卫检查 -> 工具查找 -> 执行 -> 异常捕获
 */
async function executeSingleTool(
    name: string,
    args: Record<string, unknown> | undefined,
    hooks: {
        executeTool?: RunAgentOptions["executeTool"];
        toolGuard?: RunAgentOptions["toolGuard"];
    }
): Promise<string> {
    // 场景 A：如果外部提供了自定义执行器，透传执行并将异常转为 observation（生产上禁止因单次工具抛错中断整轮对话）
    if (hooks.executeTool) {
        try {
            return await hooks.executeTool(name, args);
        } catch (err) {
            return formatExecuteToolException(err);
        }
    }

    // 场景 B：使用默认执行逻辑
    // 1. 权限拦截校验（守卫若抛错则视为可恢复的 observation，避免中断 ReAct）
    let guard: ToolGuardResult;
    try {
        guard = normalizeToolGuardResult(hooks.toolGuard?.(name, args));
    } catch (err) {
        return formatExecuteToolException(err);
    }
    if (!guard.allow) {
        return guard.message; // 返回拦截信息给 LLM，让 LLM 决定如何回复用户
    }

    // 2. 从注册表获取工具实例
    const tool = getTool(name);
    if (!tool) {
        return `错误：未知工具 "${name}"`;
    }

    // 3. 执行工具并处理潜在的运行时错误
    try {
        return await tool.execute(args ?? {});
    } catch (err) {
        // 捕获异常并将错误转化为文本，传回给 LLM 尝试自愈或报错
        return `工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
    }
}
