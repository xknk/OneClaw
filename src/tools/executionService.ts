import type { ToolSchema } from "@/llm/providers/ModelProvider";
import { ToolRegistry } from "./registry";
import type {
    ToolDefinition,
    ToolExecutionContext,
    ToolExecutionResult,
    ToolProvider,
} from "./types";
import { ProviderHealth } from "./providerHealth";

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
    toolGuard?: (toolName: string, args: Record<string, unknown> | undefined) => string | null;

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
        // 检查是否超过单请求最大调用次数
        const used = (this.callCount.get(name) ?? 0) + 1;
        // 更新调用次数
        this.callCount.set(name, used);
        // 如果超过单请求最大调用次数，则返回错误描述
        if (used > this.maxCallsPerToolPerRequest) {
            const msg = `无权限：工具 ${name} 超过单请求最大调用次数 ${this.maxCallsPerToolPerRequest}`;
            await this.onFinished?.({
                toolName: name,
                args,
                result: msg,
                ok: false,
                durationMs: Date.now() - totalStarted,
                source: "guard",
                errorCode: "TOOL_CALL_LIMIT_EXCEEDED",
                attempt: 1,
            });
            return msg;
        }


        // --- 第一步：安全守卫 ---
        const denied = this.toolGuard?.(name, args);
        if (denied) { // 权限拒绝，直接返回错误描述
            await this.onFinished?.({
                toolName: name,  // 工具名称
                args, // 工具入参
                result: denied, // 工具执行结果
                ok: false, // 工具执行是否成功
                durationMs: Date.now() - totalStarted, // 工具执行耗时
                source: "policy", // 执行来源
                errorCode: "TOOL_DENIED",
            });
            return denied; // 权限拒绝，直接返回错误描述
        }

        // --- 第二步：查找工具实现 ---
        const resolved = await this.registry.resolveByName(
            name, this.ctx,
        );
        // 工具未找到，返回错误描述
        if (!resolved) {
            const msg = `错误：未知工具 "${name}"`;
            await this.onFinished?.({
                toolName: name, // 工具名称
                args, // 工具入参
                result: msg, // 工具执行结果
                ok: false, // 工具执行是否成功
                durationMs: Date.now() - totalStarted, // 工具执行耗时
                source: "registry", // 执行来源
                errorCode: "TOOL_NOT_FOUND",
            }); // 工具未找到，返回错误描述
            return msg;
        }
        // --- 第三步：参数格式验证 ---
        const validationError = validateArgs(resolved.definition.schema, args);
        if (validationError) { // 参数格式验证失败，返回错误描述
            await this.onFinished?.({
                toolName: name, // 工具名称
                args, // 工具入参
                result: validationError, // 工具执行结果
                ok: false, // 工具执行是否成功
                durationMs: Date.now() - totalStarted, // 工具执行耗时
                source: resolved.definition.source, // 执行来源
                errorCode: "TOOL_ARG_ERROR",
            }); // 参数格式验证失败，返回错误描述
            return validationError;
        }


        // 4) 超时与重试策略
        const def = resolved.definition; // 工具定义
        const timeoutMs = def.timeoutMs ?? this.defaultTimeoutMs; // 超时时间（毫秒）
        const maxRetries =
            def.retryPolicy?.maxRetries ??
            (def.riskLevel === "low" ? this.defaultLowRiskRetries : 0); // 最大重试次数
        const backoffMs = def.retryPolicy?.backoffMs ?? this.defaultBackoffMs; // 重试间隔（毫秒）

        let attempt = 0; // 重试次数
        let last: ToolExecutionResult | null = null; // 上一次执行结果
        while (attempt <= maxRetries) {
            attempt++;
            const started = Date.now(); // 开始时间（毫秒）
            try {
                const result = await await withTimeout(
                    resolved.provider.execute(name, args, this.ctx),
                    timeoutMs
                );
                if (!result) {
                    const msg = `错误：工具 "${name}" 已声明但无可执行实现`;
                    await this.onFinished?.({
                        toolName: name,
                        args,
                        result: msg,
                        ok: false,
                        durationMs: Date.now() - totalStarted,
                        source: def.source,
                        attempt,
                        errorCode: "TOOL_IMPL_MISSING",
                    });
                    return msg;
                }
                last = result;
                if (result.ok) {
                    await this.onFinished?.({ // 工具执行成功，返回结果
                        toolName: name, // 工具名称
                        args, // 工具入参
                        result: result.content, // 工具执行结果
                        ok: result.ok, // 工具执行是否成功
                        durationMs: result.durationMs, // 工具执行耗时
                        source: result.source, // 执行来源
                        attempt, // 重试次数
                    });
                    return result.content; // 返回工具执行结果
                }
                // 如果需要重试，则等待重试间隔后继续重试
                const retry = shouldRetry(def, result, attempt, maxRetries);
                if (retry) {
                    if (backoffMs > 0) await sleep(backoffMs);
                    continue;
                }
                await this.onFinished?.({ // 工具执行失败，返回结果
                    toolName: name,
                    args, // 工具入参
                    result: result.content, // 工具执行结果
                    ok: false, // 工具执行是否成功
                    durationMs: Date.now() - totalStarted, // 工具执行耗时
                    source: result.source ?? def.source, // 执行来源
                    attempt, // 重试次数
                    errorCode: result.errorCode, // 错误代码
                });
                return result.content; // 返回工具执行结果
            } catch (err) {
                // 如果超时，则返回超时错误
                const timeoutResult =
                    err instanceof Error && err.message === "TOOL_TIMEOUT"
                        ? toTimeoutError(name, timeoutMs, started, def.source)
                        : {
                            ok: false,
                            toolName: name,
                            source: def.source,
                            errorCode: "TOOL_EXEC_ERROR",
                            errorMessage: err instanceof Error ? err.message : String(err),
                            content: `工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
                            durationMs: Date.now() - started,
                        };
                // 更新上一次执行结果
                last = timeoutResult;
                // 如果需要重试，则等待重试间隔后继续重试
                const retry = shouldRetry(def, timeoutResult, attempt, maxRetries);
                // 如果需要重试，则等待重试间隔后继续重试
                if (retry) {
                    if (backoffMs > 0) await sleep(backoffMs);
                    continue;
                }
                // 工具执行失败，返回结果
                await this.onFinished?.({
                    toolName: name, // 工具名称
                    args, // 工具入参
                    result: timeoutResult.content, // 工具执行结果
                    ok: false, // 工具执行是否成功
                    durationMs: Date.now() - totalStarted, // 工具执行耗时
                    source: timeoutResult.source ?? def.source, // 执行来源
                    attempt, // 重试次数
                    errorCode: timeoutResult.errorCode, // 错误代码
                });
                return timeoutResult.content;
            }
        }
        const fallback = last?.content ?? `工具执行失败: ${name}`;
        await this.onFinished?.({
            toolName: name,
            args,
            result: fallback,
            ok: false,
            durationMs: Date.now() - totalStarted,
            source: resolved.definition.source,
            attempt: maxRetries + 1,
            errorCode: last?.errorCode ?? "TOOL_EXEC_ERROR",
        });
        return fallback;
    }
}
export function createRegistryWithProviders(providers: ToolProvider[]): ToolRegistry {
    const registry = new ToolRegistry();
    for (const p of providers) registry.register(p);
    return registry;
}