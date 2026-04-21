import dns from "node:dns/promises";

export type DnsRecordKind = "A" | "AAAA" | "TXT" | "MX" | "CNAME";

/**
 * 解析域名记录（联调用，受策略约束与 QQ 渠道限制）。
 */
export async function executeDnsResolve(args: Record<string, unknown>): Promise<string> {
    const host = typeof args?.hostname === "string" ? args.hostname.trim() : "";
    if (!host) return "缺少参数 hostname（字符串）";

    const kindRaw = typeof args?.record_type === "string" ? args.record_type.trim().toUpperCase() : "A";
    const kind = (["A", "AAAA", "TXT", "MX", "CNAME"].includes(kindRaw) ? kindRaw : "A") as DnsRecordKind;

    if (/[\\/]/.test(host) || host.length > 253) {
        return "hostname 格式无效";
    }

    try {
        switch (kind) {
            case "A": {
                const r = await dns.resolve4(host);
                return `A ${host}\n${r.join("\n")}`;
            }
            case "AAAA": {
                const r = await dns.resolve6(host);
                return `AAAA ${host}\n${r.join("\n")}`;
            }
            case "TXT": {
                const r = await dns.resolveTxt(host);
                return `TXT ${host}\n${r.map((a) => a.join("")).join("\n")}`;
            }
            case "MX": {
                const r = await dns.resolveMx(host);
                return `MX ${host}\n${r.map((m) => `${m.priority}\t${m.exchange}`).join("\n")}`;
            }
            case "CNAME": {
                const r = await dns.resolveCname(host);
                return `CNAME ${host}\n${r.join("\n")}`;
            }
            default:
                return "不支持的 record_type";
        }
    } catch (e) {
        return `DNS 查询失败: ${e instanceof Error ? e.message : String(e)}`;
    }
}
