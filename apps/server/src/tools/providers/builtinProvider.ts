import { getBuiltinToolRiskLevel, getTool, getToolSchemas } from "@/agent/tools"; // 导入底层工具的具体实现和描述文件
import type {
    ToolDefinition,
    ToolExecutionContext,
    ToolExecutionResult,
    ToolProvider,
} from "../types";

/**
 * 构建内置工具定义
 * @param schema 工具模式
 * @returns 工具定义
 */
function buildBuiltinDefinition(schema: (ReturnType<typeof getToolSchemas>)[number]): ToolDefinition {
    const risk = getBuiltinToolRiskLevel(schema.name);
    
    // 显式策略：不要依赖 executionService 默认值
    if (risk === "high") {
        return {
            name: schema.name,
            schema,
            source: "builtin",
            riskLevel: risk,
            version: "1",
            owner: "core",
            idempotent: false,
            timeoutMs: 20_000,
            retryPolicy: { maxRetries: 0, backoffMs: 0 },
        };
    }
    if (risk === "medium") {
        return {
            name: schema.name,
            schema,
            source: "builtin",
            riskLevel: risk,
            version: "1",
            owner: "core",
            idempotent: true,
            timeoutMs: 20_000,
            retryPolicy: { maxRetries: 0, backoffMs: 100 },
        };
    }
    return {
        name: schema.name,
        schema,
        source: "builtin",
        riskLevel: "low",
        version: "1",
        owner: "core",
        idempotent: true,
        timeoutMs: 10_000,
        retryPolicy: { maxRetries: 1, backoffMs: 200 },
    };
}

/**
 * 系统内置工具提供者
 * 负责管理如：文件读写、代码执行、补丁应用等核心原子能力
 */
export const builtinProvider: ToolProvider = {
    id: "builtin",    // 唯一标识符
    priority: 10,     // 较高的优先级，确保核心工具能被优先发现或被自定义工具覆盖

    // 返回所有内置工具的定义-判断其风险等级和幂等性
    async listDefinitions(): Promise<ToolDefinition[]> {
        return getToolSchemas().map(buildBuiltinDefinition);
      },

    
    /**
     * 执行具体的内置工具
     * @param name 要执行的工具名称
     * @param args 工具所需的参数对象
     * @param _ctx 上下文信息（此 provider 暂时未用到上下文，故以 _ 开头）
     */
    async execute(
        name: string,
        args: Record<string, unknown> | undefined,
        ctx: ToolExecutionContext
    ): Promise<ToolExecutionResult | null> {
        // 从底层库中获取真正的执行函数
        const tool = getTool(name);
        if (!tool) return null; // 如果该 provider 下没找到这个工具，返回 null 让 registry 尝试其他 provider

        const started = Date.now(); // 记录开始时间以计算耗时
        try {
            // 执行底层工具逻辑，args 缺省则传空对象
            const content = await tool.execute(args ?? {}, ctx);

            // 返回标准化的成功结果
            return {
                ok: true,
                content, // 工具执行后的返回字符串（通常是 LLM 需要读的数据）
                durationMs: Date.now() - started,
                source: "builtin",
                toolName: name,
            };
        } catch (err) {
            // 异常捕获：将 JS 错误转化为标准化的错误响应
            return {
                ok: false,
                content: `工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
                errorCode: "TOOL_EXEC_ERROR",
                errorMessage: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - started,
                source: "builtin",
                toolName: name,
            };
        }
    },
};
