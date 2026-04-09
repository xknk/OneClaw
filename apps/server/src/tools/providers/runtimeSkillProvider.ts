import type { ToolSchema } from "@/llm/providers/ModelProvider";
import { getRuntimeSkillTool } from "@/skills/toolImplRegistry";
import type {
    RetryPolicy,
    ToolDefinition,
    ToolExecutionContext,
    ToolExecutionResult,
    ToolProvider,
    ToolRiskLevel
} from "../types";

/**
 * 扩展工具模式
 * 包含风险等级、超时时间、重试次数、重试间隔和幂等性设置
 */
type ExtendedToolSchema = ToolSchema & {
    "x-risk-level"?: ToolRiskLevel;
    "x-timeout-ms"?: number;
    "x-retry-max"?: number;
    "x-retry-backoff-ms"?: number;
    "x-idempotent"?: boolean;
};
/**
 * 最大超时时间
 */
const MAX_TIMEOUT_MS = 60_000;
/**
 * 最大重试次数
 */
const MAX_RETRY = 3;
/**
 * 最大重试间隔
 */
const MAX_BACKOFF_MS = 5_000;

/**
 * 限制整数在指定范围内
 * @param v 要限制的值
 * @param min 最小值
 * @param max 最大值
 * @returns 限制后的值
 */
function clampInt(v: unknown, min: number, max: number): number | undefined {
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    const n = Math.trunc(v);
    return Math.max(min, Math.min(max, n));
}

/**
 * 根据工具名称判断风险等级
 * @param name 工具名称
 * @returns 风险等级
 */
function fallbackRiskByName(name: string): ToolRiskLevel {
    if (name === "exec" || name === "apply_patch") return "high";
    return "low";
}

/**
 * 标准化风险等级
 * @param v 要标准化的值
 * @param fallback 默认值
 * @returns 标准化后的值
 */
function normalizeRisk(v: unknown, fallback: ToolRiskLevel): ToolRiskLevel {
    if (v === "low" || v === "medium" || v === "high") return v;
    return fallback;
}
/**
 * 将工具 Schema 转换为重试策略
 * @param schema 工具 Schema
 * @param risk 风险等级
 * @returns 重试策略
 */
function toRetryPolicy(schema: ExtendedToolSchema, risk: ToolRiskLevel): RetryPolicy {
    const defaultMax = risk === "low" ? 1 : 0;
    const defaultBackoff = risk === "low" ? 200 : 0;
    const maxRetries = clampInt(schema["x-retry-max"], 0, MAX_RETRY) ?? defaultMax;
    const backoffMs = clampInt(schema["x-retry-backoff-ms"], 0, MAX_BACKOFF_MS) ?? defaultBackoff;
    return { maxRetries, backoffMs };
}
/**
 * 将工具 Schema 转换为内部标准的工具定义
 * 包含风险等级评估和幂等性设置
 */
function toDefinition(schema: ToolSchema): ToolDefinition {
    const ext = schema as ExtendedToolSchema; // 将工具 Schema 转换为扩展工具 Schema
    const fallback = fallbackRiskByName(schema.name); // 默认风险等级
    const risk = normalizeRisk(ext["x-risk-level"], fallback); // 标准化风险等级
    const timeoutMs = clampInt(ext["x-timeout-ms"], 100, MAX_TIMEOUT_MS) ?? 15_000;
    const retryPolicy = toRetryPolicy(ext, risk); // 标准化重试策略
    // 强制安全兜底：高风险不重试（即使 skill 里声明了重试）
    if (risk === "high") {
        retryPolicy.maxRetries = 0;
        retryPolicy.backoffMs = 0;
    }
    // 只有非修改类操作才具有幂等性（多次调用效果相同）
    const idempotent =
        typeof ext["x-idempotent"] === "boolean"
            ? ext["x-idempotent"]
            : risk !== "high";
    return {
        name: schema.name, // 工具名称
        schema, // 工具 Schema
        source: "skill", // 工具来源
        // 敏感操作（执行脚本、修改代码）标记为高风险，可能需要二次人工确认
        riskLevel: risk, // 风险等级
        version: "1", // 工具版本
        owner: "skill", // 工具归属
        idempotent, // 幂等性
        timeoutMs, // 超时时间
        retryPolicy, // 重试策略
    };
}

/**
 * 运行时技能提供者工厂函数：
 * 负责将动态加载的 Skill 注入到 AI 的工具调用流程中
 */
export function createRuntimeSkillProvider(skillSchemas: ToolSchema[]): ToolProvider {
    // 初始化时预先转换好所有工具定义
    const defs = skillSchemas.map(toDefinition);

    return {
        id: "skill-runtime",
        priority: 20, // 优先级设为 20，确保 Skill 可以覆盖同名的内置工具 (builtin)

        /**
         * 返回当前 Provider 支持的所有工具列表
         */
        async listDefinitions(): Promise<ToolDefinition[]> {
            return defs;
        },

        /**
         * 执行具体的工具逻辑
         * @param name 工具名称
         * @param args 工具参数
         */
        async execute(
            name: string,
            args: Record<string, unknown> | undefined,
            _ctx: ToolExecutionContext
        ): Promise<ToolExecutionResult | null> {
            // 从全局注册表中获取该 Skill 的具体代码实现
            const tool = getRuntimeSkillTool(name);
            if (!tool) return null; // 如果没找到实现，返回 null 让其他 Provider 尝试

            const started = Date.now();
            try {
                // 执行工具逻辑并传入参数
                const content = await tool.execute(args ?? {});
                return {
                    ok: true,
                    content,
                    durationMs: Date.now() - started,
                    source: "skill",
                    toolName: name,
                };
            } catch (err) {
                // 统一错误处理，封装成符合接口规范的失败响应
                return {
                    ok: false,
                    content: `工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
                    errorCode: "TOOL_EXEC_ERROR",
                    errorMessage: err instanceof Error ? err.message : String(err),
                    durationMs: Date.now() - started,
                    source: "skill",
                    toolName: name,
                };
            }
        },
    };
}
