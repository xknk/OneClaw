import { appConfig } from "@/config/evn";
import { isBlockedFetchHostname } from "./fetchUrl";

function truncateBody(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…（已截断）`;
}

/** 从 RSS/Atom 粗略抽取若干条目标题与链接（非完整 XML 解析）。 */
export async function executeFetchFeed(args: Record<string, unknown>): Promise<string> {
    if (!appConfig.fetchUrlEnabled) {
        return "fetch_feed 已通过 ONECLAW_FETCH_URL_ENABLED 关闭";
    }
    const raw = typeof args?.url === "string" ? args.url.trim() : "";
    if (!raw) return "缺少参数 url（feed 的 http(s) 地址）";

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
        return "出于安全策略，不允许访问该主机。";
    }

    const maxItems = Math.min(
        50,
        Math.max(
            1,
            typeof args?.max_items === "number" && Number.isFinite(args.max_items)
                ? Math.floor(args.max_items)
                : 15,
        ),
    );
    const maxChars = Math.min(200_000, appConfig.fetchMaxResponseChars);

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), appConfig.fetchTimeoutMs);
    try {
        const res = await fetch(parsed.toString(), {
            method: "GET",
            redirect: "follow",
            signal: ac.signal,
            headers: {
                Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                "User-Agent": "OneClaw-fetch_feed/1.0",
            },
        });
        const xml = Buffer.from(await res.arrayBuffer()).toString("utf8");
        if (!res.ok) {
            return `HTTP ${res.status}\n${truncateBody(xml, 1200)}`;
        }

        const out: string[] = [`status: ${res.status}`, `url: ${res.url}`, ""];
        const isAtom = /<feed[\s>]/i.test(xml.slice(0, 800));
        if (isAtom) {
            const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
            let n = 0;
            for (const block of entries) {
                if (n >= maxItems) break;
                const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "")?.trim();
                const link =
                    block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
                    block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim();
                n++;
                out.push(`${n}. ${title ?? "(no title)"}`);
                if (link) out.push(`   ${link}`);
                out.push("");
            }
        } else {
            const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
            let n = 0;
            for (const block of items) {
                if (n >= maxItems) break;
                const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")?.replace(/<[^>]+>/g, "")?.trim();
                const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim();
                n++;
                out.push(`${n}. ${title ?? "(no title)"}`);
                if (link) out.push(`   ${link}`);
                out.push("");
            }
        }

        const body = out.join("\n").trim();
        return truncateBody(body, maxChars);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("abort")) return `请求超时（>${appConfig.fetchTimeoutMs}ms）`;
        return `拉取失败: ${msg}`;
    } finally {
        clearTimeout(t);
    }
}
