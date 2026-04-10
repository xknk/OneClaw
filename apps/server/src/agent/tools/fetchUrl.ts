import { appConfig } from "@/config/evn";

/** 解析 hostname 是否为应禁止访问的内网/元数据地址（防 SSRF；可通过 ONECLAW_FETCH_ALLOW_PRIVATE_HOSTS 关闭） */
export function isBlockedFetchHostname(hostname: string): boolean {
    const h = hostname.trim().toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost")) return true;
    if (h === "0.0.0.0") return true;
    if (h === "[::1]" || h === "::1") return true;

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const m = h.match(ipv4);
    if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        return false;
    }
    return false;
}

function truncateBody(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…（已截断，共 ${text.length} 字符；可调小 max_chars 或提高 ONECLAW_FETCH_MAX_RESPONSE_CHARS）`;
}

/**
 * 拉取公开 HTTP(S) 网页正文（UTF-8）；二进制响应仅返回说明。
 */
export async function executeFetchUrl(args: Record<string, unknown>): Promise<string> {
    if (!appConfig.fetchUrlEnabled) {
        return "fetch_url 已通过 ONECLAW_FETCH_URL_ENABLED 关闭";
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

    const maxChars = Math.min(
        appConfig.fetchMaxResponseChars,
        typeof args?.max_chars === "number" && Number.isFinite(args.max_chars) && args.max_chars > 0
            ? Math.floor(args.max_chars)
            : appConfig.fetchMaxResponseChars
    );

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), appConfig.fetchTimeoutMs);
    try {
        const res = await fetch(parsed.toString(), {
            method: "GET",
            redirect: "follow",
            signal: ac.signal,
            headers: {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
                "User-Agent": "OneClaw-fetch_url/1.0",
            },
        });
        const ct = res.headers.get("content-type") ?? "";
        const buf = Buffer.from(await res.arrayBuffer());

        if (!ct.toLowerCase().includes("text/") && !ct.toLowerCase().includes("json") && !ct.toLowerCase().includes("xml")) {
            if (!ct.toLowerCase().includes("javascript")) {
                return [
                    `status: ${res.status}`,
                    `url: ${res.url}`,
                    `content-type: ${ct || "(none)"}`,
                    "",
                    `[非文本内容已省略，${buf.length} 字节]`,
                ].join("\n");
            }
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
