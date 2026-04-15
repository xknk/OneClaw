import { HttpError } from "./error";

/**
 * HttpClient 配置项
 */
export type HttpClientOptions = {
    timeoutMs?: number; // 超时时间（毫秒）
    headers?: Record<string, string>; // 自定义请求头
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
    const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: extraHeaders = {} } = options;

    // --- 1. 超时控制器设置 ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

        // 处理其他错误（如网络断开或手动取消请求 AbortError）
        throw err;
    } finally {
        // --- 8. 清理工作 ---
        // 无论成功还是失败，都必须清除定时器，防止 Node.js 进程无法退出
        clearTimeout(timeoutId);
    }
}
