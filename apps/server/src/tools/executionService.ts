import type { ToolSchema } from "@/llm/providers/ModelProvider";
import { ToolRegistry } from "./registry";
import type {
    ToolDefinition,
    ToolExecutionContext,
    ToolExecutionResult,
    ToolProvider,
} from "./types";
import { ProviderHealth } from "./providerHealth";
import type { ToolGuardResult } from "@/security/toolGuard";
import { normalizeToolGuardResult } from "@/security/toolGuard";
import { sanitizeToolArgsForTrace } from "@/security/auditSanitize";
/**
 * 工具执行服务的配置选项
 */
export interface ToolExecutionServiceOptions {
    registry: ToolRegistry;         // 工具注册表，用于查找工具
    ctx: ToolExecutionContext;      // 当前执行的上下文（用户、会话等）

    /** 
     * 工具守卫（拦截器）
     * 在执行前检查权限。返回 string 表示拒绝原因，返回 null 表示允许执行。
     */
    toolGuard?: (
        toolName: string,
        args: Record<string, unknown> | undefined
    ) => string | null | ToolGuardResult;
    /** 
     * 钩子函数：工具执行完成后触发
     * 常用于审计日志、耗时统计或前端 UI 状态更新
     */
    onFinished?: (event: {
        toolName: string;
        args: Record<string, unknown> | undefined;
        result: string;
        ok: boolean;
        durationMs: number;
        source?: string;
        attempt?: number;
        errorCode?: string;
    }) => Promise<void> | void;
    // 新增：执行策略默认值（可选）
    defaultTimeoutMs?: number; // 默认 15s
    defaultLowRiskRetries?: number; // 默认 1
    defaultBackoffMs?: number; // 默认 200ms
    maxCallsPerToolPerRequest?: number; // 默认 3
    health?: ProviderHealth;
    trace?: (eventType: string, patch?: Record<string, unknown>) => Promise<void> | void;

}

/**
 * 睡眠函数
 * @param ms 睡眠时间（毫秒）
 */
function sleep(ms: number): Promise<void> {
    // 使用 setTimeout 实现睡眠
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * 超时处理函数
 * @param p 原始 Promise
 * @param timeoutMs 超时时间（毫秒）
 */
function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
    // 如果超时时间不合法，直接返回原始 Promise
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return p;
    // 创建新的 Promise，用于超时处理
    return new Promise<T>((resolve, reject) => {
        // 创建超时定时器
        const timer = setTimeout(() => {
            // 超时后，拒绝 Promise，抛出错误
            reject(new Error("TOOL_TIMEOUT"));
        }, timeoutMs);
        p.then(
            (v) => {
                // 清除超时定时器
                clearTimeout(timer);
                resolve(v);
            },
            (err) => {
                // 清除超时定时器
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}


/**
 * 参数校验函数
 * 确保 LLM 传来的参数符合定义的 JSON Schema，防止底层函数因参数格式错误崩溃
 */
function validateArgs(schema: ToolSchema | undefined, args: Record<string, unknown> | undefined): string | null {
    if (!schema || !schema.parameters || schema.parameters.type !== "object") return null;

    const input = args ?? {};
    // 1. 必填参数校验
    const required = Array.isArray(schema.parameters.required) ? schema.parameters.required : [];
    for (const key of required) {
        if (!(key in input)) return `参数错误：缺少必填参数 ${key}`;
    }

    // 2. 基础类型校验
    const props = schema.parameters.properties ?? {};
    for (const [key, val] of Object.entries(input)) {
        const p = props[key];
        if (!p?.type) continue;
        if (p.type === "string" && typeof val !== "string") return `参数错误：${key} 应为 string`;
        if (p.type === "number" && typeof val !== "number") return `参数错误：${key} 应为 number`;
        if (p.type === "boolean" && typeof val !== "boolean") return `参数错误：${key} 应为 boolean`;
        if (p.type === "object" && (typeof val !== "object" || val === null || Array.isArray(val))) {
            return `参数错误：${key} 应为 object`;
        }
    }

    return null;
}

/**
 * 将超时错误转换为 ToolExecutionResult 格式
 * @param name 工具名称
 * @param timeoutMs 超时时间（毫秒）
 * @param started 开始时间（毫秒）
 * @param source 执行来源
 */
function toTimeoutError(name: string, timeoutMs: number, started: number, source?: string): ToolExecutionResult {
    return {
        ok: false,
        toolName: name,
        source: source as ToolExecutionResult["source"],
        errorCode: "TOOL_TIMEOUT",
        errorMessage: `工具执行超时（>${timeoutMs}ms）`,
        content: `工具执行超时（>${timeoutMs}ms）`,
        durationMs: Date.now() - started,
    };
}


/**
 * 判断是否需要重试
 * @param def 工具定义
 * @param result 执行结果
 * @param attempt 重试次数
 * @param maxRetries 最大重试次数
 */
function shouldRetry(def: ToolDefinition, result: ToolExecutionResult, attempt: number, maxRetries: number): boolean {
    // 如果重试次数超过最大重试次数，则不重试
    if (attempt > maxRetries) return false;
    // 生产策略：高风险不重试；低/中风险仅对超时或执行错误重试
    if (def.riskLevel === "high") return false;
    if (result.errorCode === "TOOL_TIMEOUT") return true;
    if (result.errorCode === "TOOL_EXEC_ERROR") return true;
    return false;
}

/**
 * 工具执行服务类
 * 封装了从“接收 LLM 请求”到“返回结果”的标准化流程
 */
export class ToolExecutionService {
    private readonly registry: ToolRegistry; // 工具注册表，用于查找工具
    private readonly ctx: ToolExecutionContext; // 当前执行的上下文（用户、会话等）
    private readonly toolGuard?: ToolExecutionServiceOptions["toolGuard"]; // 工具守卫（拦截器）
    private readonly onFinished?: ToolExecutionServiceOptions["onFinished"]; // 钩子函数：工具执行完成后触发    
    private catalogCache: ToolDefinition[] | null = null; // 缓存工具列表，避免频繁解析
    private readonly defaultTimeoutMs: number; // 默认超时时间（毫秒）
    private readonly defaultLowRiskRetries: number; // 默认低风险重试次数
    private readonly defaultBackoffMs: number; // 默认重试间隔（毫秒）
    private readonly maxCallsPerToolPerRequest: number;
    private readonly callCount = new Map<string, number>();
    private readonly health?: ProviderHealth;
    private readonly trace?: ToolExecutionServiceOptions["trace"];


    constructor(options: ToolExecutionServiceOptions) {
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15000; // 默认超时时间（毫秒）
        this.defaultLowRiskRetries = options.defaultLowRiskRetries ?? 1; // 默认低风险重试次数
        this.defaultBackoffMs = options.defaultBackoffMs ?? 200; // 默认重试间隔（毫秒）
        this.registry = options.registry; // 工具注册表，用于查找工具
        this.ctx = options.ctx; // 当前执行的上下文（用户、会话等）
        this.toolGuard = options.toolGuard; // 工具守卫（拦截器）
        this.onFinished = options.onFinished; // 钩子函数：工具执行完成后触发
        this.maxCallsPerToolPerRequest = options.maxCallsPerToolPerRequest ?? 3; // 默认最大调用次数
        this.health = options.health; // 健康状态检查
        this.trace = options.trace;  // 追踪事件

    }

    /**
     * 获取所有可调用的工具 Schema
     * 通常发给 LLM，让它知道有哪些工具可用
     */
    async getToolSchemas(): Promise<ToolSchema[]> {
        if (!this.catalogCache) {
            // 从注册表中解析出当前上下文可用的所有工具
            const list = await this.registry.listResolved(
                this.ctx,
                { health: this.health }
            );
            this.catalogCache = list.map((x) => x.definition);
        }
        return this.catalogCache.map((x) => x.schema);
    }

    /**
     * 执行工具的核心流程
     * 包含：拦截 -> 查找 -> 校验 -> 执行 -> 回调
     */
    async execute(name: string, args: Record<string, unknown> | undefined): Promise<string> {
        const totalStarted = Date.now();

        // --- 0. 修正后的初始 Trace ---
        // 移除了 errorCode，并将 ok 设为 true，代表流程正常启动
        await this.trace?.("tool.execute.start", {
            toolName: name,
            toolSource: "guard",
            ok: true,
            durationMs: 0,
            attempt: 1,
        });

        // 检查是否超过单请求最大调用次数
        const used = (this.callCount.get(name) ?? 0) + 1;
        this.callCount.set(name, used);

        if (used > this.maxCallsPerToolPerRequest) {
            const msg = `无权限：工具 ${name} 超过单请求最大调用次数 ${this.maxCallsPerToolPerRequest}`;
            const errorCode = "TOOL_CALL_LIMIT_EXCEEDED";

            await this.onFinished?.({
                toolName: name,
                args,
                result: msg,
                ok: false,
                durationMs: Date.now() - totalStarted,
                source: "guard",
                errorCode,
                attempt: 1,
            });
            await this.trace?.("tool.failed", {
                toolName: name,
                toolSource: "guard",
                ok: false,
                durationMs: Date.now() - totalStarted,
                errorCode,
                attempt: 1,
            });
            return msg;
        }

        // --- 第一步：安全守卫 ---
        const guard = normalizeToolGuardResult(this.toolGuard?.(name, args));
        if (!guard.allow) {
            const deniedMsg = guard.message;
            const policyCode = guard.errorCode;
            const meta = sanitizeToolArgsForTrace(name, args, guard.auditMeta);
            await this.onFinished?.({
                toolName: name,
                args,
                result: deniedMsg,
                ok: false,
                durationMs: Date.now() - totalStarted,
                source: "policy",
                errorCode: policyCode,
            });
            await this.trace?.("tool.denied", {
                toolName: name,
                toolSource: "policy",
                ok: false,
                durationMs: Date.now() - totalStarted,
                errorCode: policyCode,
                attempt: 1,
                meta,
            });
            return deniedMsg;
        }

        // --- 第二步：查找工具实现 ---
        const resolved = await this.registry.resolveByName(
            name, this.ctx,
            { health: this.health }
        );

        // 💡 这里的 resolved.definition 包含了工具的只读元数据
        // 供上层 runTools 判断 isConcurrencySafe
        await this.trace?.("tool.resolve", {
            toolName: name,
            toolSource: resolved?.definition.source,
            meta: {
                providerId: resolved?.provider.id,
                // 记录该工具是否为只读，方便在 Trace 中分析并发行为
                isReadOnly: resolved?.definition.riskLevel === "low"
            },
        });

        if (!resolved) {
            const msg = `错误：未知工具 "${name}"`;
            const errorCode = "TOOL_NOT_FOUND";
            await this.onFinished?.({
                toolName: name,
                args,
                result: msg,
                ok: false,
                durationMs: Date.now() - totalStarted,
                source: "registry",
                errorCode,
            });
            await this.trace?.("tool.failed", {
                toolName: name,
                toolSource: "registry",
                ok: false,
                durationMs: Date.now() - totalStarted,
                errorCode,
                attempt: 1,
            });
            return msg;
        }

        // --- 第三步：参数格式验证 ---
        const validationError = validateArgs(resolved.definition.schema, args);
        if (validationError) {
            const errorCode = "TOOL_ARG_ERROR";
            await this.onFinished?.({
                toolName: name,
                args,
                result: validationError,
                ok: false,
                durationMs: Date.now() - totalStarted,
                source: resolved.definition.source,
                errorCode,
            });
            await this.trace?.("tool.validation.failed", {
                toolName: name,
                toolSource: resolved.definition.source,
                ok: false,
                durationMs: Date.now() - totalStarted,
                errorCode,
                attempt: 1,
            });
            return validationError;
        }

        // --- 第四步：超时与重试策略 ---
        const def = resolved.definition;
        const timeoutMs = def.timeoutMs ?? this.defaultTimeoutMs;
        const maxRetries =
            def.retryPolicy?.maxRetries ??
            (def.riskLevel === "low" ? this.defaultLowRiskRetries : 0);
        const backoffMs = def.retryPolicy?.backoffMs ?? this.defaultBackoffMs;

        let attempt = 0;
        let lastError: any = null;

        while (attempt <= maxRetries) {
            attempt++;
            try {
                const result = await withTimeout(
                    resolved.provider.execute(name, args, this.ctx),
                    timeoutMs
                );

                if (!result) {
                    throw new Error("TOOL_IMPL_MISSING");
                }

                if (result.ok) {
                    await this.onFinished?.({
                        toolName: name,
                        args,
                        result: result.content,
                        ok: true,
                        durationMs: result.durationMs,
                        source: result.source,
                        attempt,
                    });
                    await this.trace?.("tool.execute.end", {
                        toolName: name,
                        toolSource: result.source ?? def.source,
                        ok: true,
                        durationMs: result.durationMs,
                        attempt,
                    });
                    return result.content;
                }

                // 检查是否重试
                if (shouldRetry(def, result, attempt, maxRetries)) {
                    if (backoffMs > 0) await sleep(backoffMs);
                    continue;
                }

                // 执行失败但不重试的情况
                await this.onFinished?.({
                    toolName: name,
                    args,
                    result: result.content,
                    ok: false,
                    durationMs: Date.now() - totalStarted,
                    source: result.source ?? def.source,
                    attempt,
                    errorCode: result.errorCode,
                });
                return result.content;

            } catch (e: any) {
                lastError = e;
                // 💡 关键修复：
                // 如果已经达到最大重试次数，或者该工具本身就是高风险(riskLevel === "high")
                // 应该立刻中断循环，不再进行下一次 attempt
                if (attempt > maxRetries || def.riskLevel === "high") {
                    break;
                }
                if (backoffMs > 0) await sleep(backoffMs);
            }
        }

        // 最终失败出口
        const finalMsg = `工具执行失败: ${lastError?.message || "未知错误"}`;
        return finalMsg;
    }

}
export function createRegistryWithProviders(providers: ToolProvider[]): ToolRegistry {
    const registry = new ToolRegistry();
    for (const p of providers) registry.register(p);
    return registry;
}