import { HttpError } from "./error";

/**
 * HttpClient 配置项
 */
export type HttpClientOptions = {
    timeoutMs?: number; // 超时时间（毫秒）
    headers?: Record<string, string>; // 自定义请求头
    signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 60_000; // 默认超时：60秒

/**
 * 发送 POST 请求并处理 JSON 响应
 * @param url 请求地址
 * @param body 请求体（自动序列化为 JSON）
 * @param options 配置项
 */
export async function postJson<T>(
    url: string,
    body: unknown,
    options: HttpClientOptions = {}
): Promise<T> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: extraHeaders = {}, signal: userSignal } = options;

    // --- 1. 超时控制器设置 ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onUserAbort = (): void => controller.abort();
    let userHooked = false;
    if (userSignal) {
        if (userSignal.aborted) controller.abort();
        else {
            userSignal.addEventListener("abort", onUserAbort, { once: true });
            userHooked = true;
        }
    }

    try {
        // --- 2. 发起请求 ---
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...extraHeaders,
            },
            body: JSON.stringify(body),
            signal: controller.signal, // 绑定超时信号
        });

        // --- 3. 获取响应体文本 ---
        // 即使是错误响应，也要尝试读取 body 信息用于后续调试
        const text = await res.text().catch(() => "");

        // --- 4. 处理 HTTP 状态码错误 (4xx, 5xx) ---
        // 注意：原生 fetch 只有在网络故障时才抛异常，状态码 404/500 是不抛异常的
        if (!res.ok) {
            throw new HttpError(
                `HTTP ${res.status}: ${res.statusText}`, // 错误消息
                res.status,                             // 状态码
                url,                                    // 请求地址
                text.slice(0, 500)                      // 截取前 500 字符作为报错片段
            );
        }

        // --- 5. 处理空响应 ---
        if (!text) return undefined as T;

        // --- 6. 解析并返回 JSON ---
        return JSON.parse(text) as T;
        
    } catch (err) {
        // --- 7. 错误分类处理 ---
        
        // 如果已经是封装好的 HttpError，直接继续向上抛出
        if (err instanceof HttpError) throw err;

        // 如果是 JSON.parse 报错（SyntaxError）
        if (err instanceof SyntaxError) {
            throw new HttpError(`Invalid JSON from ${url}`, 0, url, undefined);
        }

        // 处理其他错误（如网络断开、连接被拒绝、DNS 失败、手动取消 AbortError）
        // Node fetch 常见表现：TypeError("fetch failed")，真实原因在 err.cause.code
        const anyErr = err as any;
        const isAbort =
            (anyErr && typeof anyErr === "object" && anyErr.name === "AbortError") ||
            String(anyErr?.message || "").toLowerCase().includes("aborted");
        const causeCode = anyErr?.cause?.code ? String(anyErr.cause.code) : "";
        const causeMsg = anyErr?.cause?.message ? String(anyErr.cause.message) : "";
        const base = anyErr instanceof Error ? anyErr.message : String(anyErr);
        const detail = [base, causeCode ? `cause=${causeCode}` : "", causeMsg ? `(${causeMsg})` : ""]
            .filter(Boolean)
            .join(" ");
        if (isAbort) {
            throw new HttpError(`Network timeout after ${timeoutMs}ms: ${detail}`, 0, url, undefined);
        }
        throw new HttpError(`Network error: ${detail}`, 0, url, undefined);
    } finally {
        // --- 8. 清理工作 ---
        // 无论成功还是失败，都必须清除定时器，防止 Node.js 进程无法退出
        clearTimeout(timeoutId);
        if (userHooked) userSignal?.removeEventListener("abort", onUserAbort);
    }
}
