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

/** 
 * 默认最大迭代轮数。
 * 作用：防止 LLM 陷入逻辑死循环（例如：工具报错 -> LLM 重试 -> 工具又报错）导致 Token 消耗失控。
 */
const MAX_TOOL_ROUNDS = 5;

export interface RunAgentOptions {
    /** 允许外部自定义最大尝试次数 */
    maxToolRounds?: number;
    /** 
     * 允许传入自定义的工具元数据。
     * 例如在多 Agent 场景下，不同 Agent 可能拥有完全不同的工具权限集。
     */
    toolSchemas?: ToolSchema[];
    /**
   * 钩子函数：在工具真正执行前进行权限校验
   * @param toolName 工具名称
   * @param args 工具入参
   * @returns 返回 null 表示允许执行；返回字符串则将其作为“拒绝原因”反馈给 AI
   */
    toolGuard?: (toolName: string, args: Record<string, unknown> | undefined) => string | null;
    /**
   * 执行反馈钩子：工具执行后的“记录仪”
   * 用于将执行细节（含耗时、成功状态）发送给日志系统或监控面板
   */
    onToolCallFinished?: (event: {
        toolName: string;
        args: Record<string, unknown> | undefined;
        result: string;
        ok: boolean;
        durationMs: number; // 执行耗时（毫秒）
    }) => Promise<void> | void;
}

/**
 * 运行 Agent 任务的主入口函数
 * @param messages 初始用户输入或对话上下文
 * @param _tools 工具对象列表（目前主要通过 getTool 动态获取，此处保留用于扩展）
 * @param options 控制参数
 * @returns 最终生成的文本回复
 */
export async function runAgent(
    messages: ChatMessage[],
    _tools: Tool[],
    options?: RunAgentOptions
): Promise<string> {
    // 1. 初始化：设置最大轮数和工具定义
    const maxRounds = options?.maxToolRounds ?? MAX_TOOL_ROUNDS;
    const toolSchemas = options?.toolSchemas ?? getToolSchemas();

    /** 
     * 关键变量：agentMessages。
     * 它是 Agent 的“短期记忆”，会在循环中不断追加 assistant 的思考和 tool 的执行结果。
     */
    const agentMessages: AgentMessage[] = [...messages];
    let round = 0;
    let lastContent = ""; // 存储 LLM 最后一次生成的文本片段

    // 开启推理-执行循环
    while (round < maxRounds) {
        round++;

        /**
         * 步骤 A: 询问模型。
         * 将当前全量的上下文（含之前轮次的工具结果）发送给 LLM。
         */
        const { content, toolCalls } = await chatWithModelWithTools(agentMessages, toolSchemas);
        lastContent = content;

        /**
         * 步骤 B: 判断终止条件。
         * 如果模型没有返回任何 toolCalls，说明它认为任务已完成，或者它直接给出了最终答案。
         */
        if (toolCalls.length === 0) {
            return content || lastContent;
        }

        /**
         * 步骤 C: 记录模型的“决策过程”。
         * 将模型发出的工具调用请求 (role: assistant) 存入历史。
         * 这是必须的，因为下一轮 LLM 需要看到自己“刚才做了什么”。
         */
        agentMessages.push({
            role: "assistant",
            content,
            tool_calls: toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
        });

        /**
         * 步骤 D: 并行/顺序执行工具。
         * 遍历本次响应中所有的工具调用请求。
         */
        for (const call of toolCalls) {
            const startedAt = Date.now(); // 【新增】记录开始时间
            let result: string;
            // --- 关键步骤 A: 权限拦截 ---
            // 在执行任何代码/文件操作前，先通过外部传入的 toolGuard 校验安全性
            const denied = options?.toolGuard?.(call.name, call.args);
            if (denied) {
                // 如果被拒绝，将拒绝原因伪装成“工具执行结果”反馈给 AI，让 AI 知道此路不通
                result = denied;
            } else {
                const tool = getTool(call.name); // 根据名称从注册中心查找工具实例
                if (!tool) {
                    // 异常处理：模型可能幻觉出了一个不存在的工具名
                    result = `错误：未知工具 "${call.name}"`;
                } else {
                    try {
                        // 执行具体的业务逻辑（如搜索、计算、请求 API 等）
                        result = await tool.execute(call.args);
                    } catch (err) {
                        // 俘获工具内部执行错误，并将错误信息反馈给 LLM，让它尝试修复或换个方案
                        result = `工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
                    }
                }
            }
            
            // --- C. 后处理阶段 (监控与日志) ---
            const durationMs = Date.now() - startedAt; // 【新增】计算耗时
            options?.onToolCallFinished?.({
                toolName: call.name,
                args: call.args,
                result,
                ok: !result.startsWith("错误："),
                durationMs,
            });

            /**
             * 步骤 E: 反馈执行结果。
             * 将工具产出的真实数据 (role: tool) 存入消息队列。
             * 这一步完成后，循环回到步骤 A，LLM 将根据这个 result 进行下一步推理。
             */
            agentMessages.push({
                role: "tool",
                tool_name: call.name,
                content: result
            });
        }
    }

    /**
     * 如果达到 MAX_TOOL_ROUNDS 仍未跳出循环：
     * 说明任务过于复杂或者 LLM 陷入了死循环，直接返回已有的最后内容。
     */
    return lastContent;
}
