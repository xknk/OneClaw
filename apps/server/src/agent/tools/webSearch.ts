import { appConfig } from "@/config/evn";

/**
 * Brave Search API（需 ONECLAW_BRAVE_API_KEY 或 BRAVE_API_KEY）
 * 文档：https://api.search.brave.com/app/documentation/web-search/query
 */
export async function executeWebSearch(args: Record<string, unknown>): Promise<string> {
    const key = appConfig.braveSearchApiKey.trim();
    if (!key) {
        return (
            "未配置 Brave Search API Key。请在 .env 中设置 ONECLAW_BRAVE_API_KEY 或 BRAVE_API_KEY（https://brave.com/search/api/），" +
            "或使用 MCP 搜索类服务。"
        );
    }

    const q = typeof args?.query === "string" ? args.query.trim() : "";
    if (!q) return "缺少参数 query（字符串）";

    const count = Math.min(
        20,
        Math.max(
            1,
            typeof args?.count === "number" && Number.isFinite(args.count) ? Math.floor(args.count) : 8,
        ),
    );

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", q);
    url.searchParams.set("count", String(count));

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), Math.min(appConfig.fetchTimeoutMs, 60_000));
    try {
        const res = await fetch(url.toString(), {
            method: "GET",
            signal: ac.signal,
            headers: {
                Accept: "application/json",
                "X-Subscription-Token": key,
                "User-Agent": "OneClaw-web_search/1.0",
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return `Brave Search 错误 HTTP ${res.status}: ${text.slice(0, 500)}`;
        }
        let data: unknown;
        try {
            data = JSON.parse(text) as unknown;
        } catch {
            return `Brave Search 返回非 JSON: ${text.slice(0, 200)}`;
        }
        const web = (data as { web?: { results?: unknown[] } })?.web?.results;
        if (!Array.isArray(web) || web.length === 0) {
            return `无结果或响应格式异常（可检查配额与 query）。原始片段: ${text.slice(0, 800)}`;
        }
        const lines: string[] = [`query: ${q}`, `count: ${web.length}`, ""];
        let i = 0;
        for (const r of web) {
            i++;
            if (!r || typeof r !== "object") continue;
            const o = r as Record<string, unknown>;
            const title = typeof o.title === "string" ? o.title : "";
            const u = typeof o.url === "string" ? o.url : "";
            const desc = typeof o.description === "string" ? o.description : "";
            lines.push(`${i}. ${title}`);
            if (u) lines.push(`   ${u}`);
            if (desc) lines.push(`   ${desc}`);
            lines.push("");
        }
        return lines.join("\n").trim();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("abort")) return "Brave Search 请求超时";
        return `Brave Search 失败: ${msg}`;
    } finally {
        clearTimeout(t);
    }
}
