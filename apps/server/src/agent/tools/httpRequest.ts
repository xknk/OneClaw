import { appConfig } from "@/config/evn";
import { isBlockedFetchHostname } from "./fetchUrl";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function truncateBody(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…（已截断，共 ${text.length} 字符）`;
}

function normalizeHeaders(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
}

/**
 * 通用 HTTP 请求（与 fetch_url 共用 ONECLAW_FETCH_* 安全与超时；QQ 渠道策略同 fetch_url）。
 */
export async function executeHttpRequest(args: Record<string, unknown>): Promise<string> {
    if (!appConfig.fetchUrlEnabled) {
        return "http_request 与 fetch_url 共用 ONECLAW_FETCH_URL_ENABLED，当前已关闭";
    }
    const raw = typeof args?.url === "string" ? args.url.trim() : "";
    if (!raw) return "缺少参数 url（字符串）";

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return "无效的 url";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "仅支持 http(s) URL";
    }

    if (!appConfig.fetchAllowPrivateHosts && isBlockedFetchHostname(parsed.hostname)) {
        return "出于安全策略，不允许访问该主机（内网/本地地址）。开发环境可设置 ONECLAW_FETCH_ALLOW_PRIVATE_HOSTS=true";
    }

    const methodRaw = typeof args?.method === "string" ? args.method.trim().toUpperCase() : "GET";
    if (!ALLOWED_METHODS.has(methodRaw)) {
        return `不支持的 method: ${methodRaw}（允许 GET, POST, PUT, PATCH, DELETE, HEAD）`;
    }

    const maxChars = Math.min(
        appConfig.fetchMaxResponseChars,
        typeof args?.max_chars === "number" && Number.isFinite(args.max_chars) && args.max_chars > 0
            ? Math.floor(args.max_chars)
            : appConfig.fetchMaxResponseChars
    );

    const headers: Record<string, string> = {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "OneClaw-http_request/1.0",
        ...normalizeHeaders(args.headers),
    };

    let body: string | undefined;
    if (methodRaw !== "GET" && methodRaw !== "HEAD") {
        if (typeof args.body === "string") {
            body = args.body;
        } else if (args.body_json !== undefined) {
            body = JSON.stringify(args.body_json);
            if (!headers["Content-Type"] && !headers["content-type"]) {
                headers["Content-Type"] = "application/json";
            }
        }
    }

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), appConfig.fetchTimeoutMs);
    try {
        const res = await fetch(parsed.toString(), {
            method: methodRaw,
            redirect: "follow",
            signal: ac.signal,
            headers,
            body,
        });
        const ct = res.headers.get("content-type") ?? "";
        const buf = Buffer.from(await res.arrayBuffer());

        const textish =
            ct.toLowerCase().includes("json") ||
            ct.toLowerCase().includes("text/") ||
            ct.toLowerCase().includes("xml") ||
            ct === "" ||
            buf.length < 4096;

        if (!textish && !ct.toLowerCase().includes("javascript")) {
            return [
                `status: ${res.status}`,
                `url: ${res.url}`,
                `content-type: ${ct || "(none)"}`,
                "",
                `[非文本类响应已省略，${buf.length} 字节]`,
            ].join("\n");
        }

        let text: string;
        try {
            text = buf.toString("utf8");
        } catch {
            return `无法将响应解码为 UTF-8（${buf.length} 字节）`;
        }

        return [
            `status: ${res.status}`,
            `url: ${res.url}`,
            `content-type: ${ct || "(none)"}`,
            "",
            truncateBody(text, maxChars),
        ].join("\n");
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("abort")) return `请求超时（>${appConfig.fetchTimeoutMs}ms）`;
        return `请求失败: ${msg}`;
    } finally {
        clearTimeout(t);
    }
}
