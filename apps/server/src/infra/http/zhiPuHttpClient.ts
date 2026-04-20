import { HttpError } from "./error";

/**
 * HttpClient 配置项
 */
export type HttpClientOptions = {
    timeoutMs?: number;
    headers?: Record<string, string>;
    /** 与内部超时合并；任一触发则中止请求 */
    signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 发送 POST 请求并处理 JSON 响应（适配智谱 API /openai 格式）
 */
export async function postJson<T>(
    url: string,
    body: unknown,
    options: HttpClientOptions = {}
): Promise<T> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: extraHeaders = {}, signal: userSignal } = options;

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
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...extraHeaders,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        // ✅ 第一步：直接解析 JSON（智谱永远返回 JSON，不会返回纯文本）
        const data = await res.json();

        // ✅ 第二步：判断 HTTP 状态（你问的 res.ok 在这里用）
        if (!res.ok) {
            throw new HttpError(
                `智谱API错误 ${res.status}：${data.message || res.statusText}`,
                res.status,
                url,
                JSON.stringify(data).slice(0, 500)
            );
        }

        // ✅ 第三步：直接返回 data（智谱返回的就是完整 JSON）
        return data as T;

    } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof SyntaxError) {
            throw new HttpError("返回数据不是合法 JSON", 0, url);
        }
        throw new HttpError(`网络请求失败：${(err as Error).message}`, 0, url);
    } finally {
        clearTimeout(timeoutId);
        if (userHooked) userSignal?.removeEventListener("abort", onUserAbort);
    }
}