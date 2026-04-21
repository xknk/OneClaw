import { appConfig } from "@/config/evn";
import { isBlockedFetchHostname } from "./fetchUrl";
import { htmlToPlainText } from "./htmlToText";

function truncateBody(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…（已截断，共 ${text.length} 字符）`;
}

/**
 * 拉取 http(s) URL 并尽量转为可读纯文本（去 script/style/标签）。
 */
export async function executeFetchReadable(args: Record<string, unknown>): Promise<string> {
    if (!appConfig.fetchUrlEnabled) {
        return "fetch_readable 已通过 ONECLAW_FETCH_URL_ENABLED 关闭";
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
        return "出于安全策略，不允许访问该主机（内网/本地地址）。";
    }

    const maxChars = Math.min(
        appConfig.fetchMaxResponseChars,
        typeof args?.max_chars === "number" && Number.isFinite(args.max_chars) && args.max_chars > 0
            ? Math.floor(args.max_chars)
            : appConfig.fetchMaxResponseChars,
    );

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), appConfig.fetchTimeoutMs);
    try {
        const res = await fetch(parsed.toString(), {
            method: "GET",
            redirect: "follow",
            signal: ac.signal,
            headers: {
                Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
                "User-Agent": "OneClaw-fetch_readable/1.0",
            },
        });
        const ct = res.headers.get("content-type") ?? "";
        const buf = Buffer.from(await res.arrayBuffer());
        const utf8 = buf.toString("utf8");
        const plain =
            ct.toLowerCase().includes("html") || /<html[\s>]/i.test(utf8.slice(0, 500))
                ? htmlToPlainText(utf8)
                : utf8;

        return [
            `status: ${res.status}`,
            `url: ${res.url}`,
            `content-type: ${ct || "(none)"}`,
            "",
            truncateBody(plain, maxChars),
        ].join("\n");
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("abort")) return `请求超时（>${appConfig.fetchTimeoutMs}ms）`;
        return `请求失败: ${msg}`;
    } finally {
        clearTimeout(t);
    }
}
