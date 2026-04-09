/**
 * Agent 核心控制器
 * 
 * 核心逻辑：ReAct (Reasoning and Acting) 模式。
 * 1. 推理 (Reason)：将对话历史发给 LLM，询问“下一步该做什么”。
 * 2. 行动 (Act)：如果 LLM 决定调用工具，执行该工具并获取结果。
 * 3. 循环 (Loop)：将结果反馈给 LLM，开启下一轮推理，直到任务完成。
 */

import type { ChatMessage, AgentMessage, ToolSchema } from "@/llm/providers/ModelProvider";
import { chatWithModelWithTools } from "@/llm/model";
import { getTool, getToolSchemas } from "./tools/index";
import type { Tool } from "./types";
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
    onModelEvent?: (event: {
        type: "llm.request" | "llm.response";
        round: number;
        toolCallCount?: number;
        contentLength?: number;
    }) => Promise<void> | void;
}

/**
 * runAgent: 执行 Agent 任务的核心入口
 * 
 * @param messages 初始对话历史
 * @param _tools (占位参数) 兼容性工具列表
 * @param options 控制参数
 * @returns 最终 LLM 生成的回复字符串
 */
export async function runAgent(
    messages: ChatMessage[],
    _tools: Tool[],
    options?: RunAgentOptions
): Promise<string> {
    const maxRounds = options?.maxToolRounds ?? MAX_TOOL_ROUNDS;
    const toolSchemas = options?.toolSchemas ?? getToolSchemas();

    // 拷贝并维护一份 Agent 内部的消息列表，用于在循环中不断追加上下文
    const agentMessages: AgentMessage[] = [...messages];
    let round = 0;
    let lastContent = "";

    // --- ReAct 核心循环开始 ---
    while (round < maxRounds) {
        round++;

        // 1. 发起推理请求
        await options?.onModelEvent?.({
            type: "llm.request",
            round,
            contentLength: agentMessages.length,
        });

        // 调用模型获取响应：包含 content (回复文本) 和 toolCalls (工具调用请求)
        const { content, toolCalls } = await chatWithModelWithTools(agentMessages, toolSchemas);
        lastContent = content;

        await options?.onModelEvent?.({
            type: "llm.response",
            round,
            toolCallCount: toolCalls.length,
            contentLength: content?.length ?? 0,
        });

        // 【出口】：如果模型不再需要调用任何工具，认为任务已完成，直接返回内容
        if (toolCalls.length === 0) {
            return content || lastContent;
        }

        // 2. 准备执行工具：先将模型生成的回复和调用请求记录到上下文中
        agentMessages.push({
            role: "assistant",
            content,
            tool_calls: toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
        });

        // 3. 执行行动 (Acting)：并行或串行处理模型请求的所有工具
        for (const call of toolCalls) {
            const startedAt = Date.now();
            
            // 执行具体工具
            const result = await executeSingleTool(call.name, call.args, {
                executeTool: options?.executeTool,
                toolGuard: options?.toolGuard,
            });

            const durationMs = Date.now() - startedAt;

            // 触发工具调用结束回调
            options?.onToolCallFinished?.({
                toolName: call.name,
                args: call.args,
                result,
                // 根据结果字符串前缀简单判断执行状态
                ok: !(
                    result.startsWith("错误：") ||
                    result.startsWith("无权限：") ||
                    result.startsWith("参数错误：") ||
                    result.startsWith("工具执行失败:")
                ),
                durationMs,
            });

            // 4. 反馈 (Observation)：将工具返回的结果推入消息流
            // LLM 在下一轮循环中会基于此结果进行后续推理
            agentMessages.push({
                role: "tool",
                tool_name: call.name,
                content: result,
            });
        }
    }

    // 若达到最大轮数仍未给出最终结果，返回最后一次生成的内容
    return lastContent;
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
    // 场景 A：如果外部提供了自定义执行器，直接透传执行
    if (hooks.executeTool) {
        return await hooks.executeTool(name, args);
    }

    // 场景 B：使用默认执行逻辑
    // 1. 权限拦截校验
    const guard = normalizeToolGuardResult(hooks.toolGuard?.(name, args));
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
