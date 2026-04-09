import { Command } from "commander";
import {
    collectEventsSince,
    findEventsByTraceId,
    traceLogDir,
} from "@/observability/traceQuery";

export function parseSinceToMs(s: string): number {
    const m = String(s).trim().match(/^(\d+)(h|d|m|s)$/i);
    if (!m) {
        throw new Error(`无效的 --since 格式: ${s}（示例: 24h, 1d, 30m）`);
    }
    const n = Number(m[1]);
    const u = m[2].toLowerCase();

    if (u === "h") return n * 3_600_000;
    if (u === "d") return n * 86_400_000;
    if (u === "m") return n * 60_000;
    return n * 1000;
}

function needTraceIdHint(cmd: string): string {
    return `请提供 traceId，例如：pnpm cli ${cmd} <traceId> 或 -i <traceId>`;
}

export function registerTraceCommands(program: Command): void {
    const trace = program.command("trace").description("Trace 查询与诊断（JSONL）");
    trace.alias("tr");

    trace
        .command("dir")
        .description("打印 trace 日志目录")
        .alias("path")
        .action(() => {
            console.log(traceLogDir());
        });

    trace
        .command("get")
        .description("按 traceId 输出完整事件链（JSON 数组）")
        .argument("[traceId]", "traceId")
        .option("-i, --id <traceId>", "traceId（与位置参数二选一）")
        .option("-d, --days <n>", "扫描最近 N 天的日志文件", "14")
        .action(async (traceId: string | undefined, opts: { id?: string; days: string }) => {
            const id = (traceId?.trim() || opts.id?.trim() || "").trim();
            if (!id) {
                console.error(needTraceIdHint("trace get"));
                process.exitCode = 1;
                return;
            }
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
            const events = await findEventsByTraceId(id, days);

            if (!events.length) {
                console.error("未找到该 traceId（请确认目录与天数，或检查 ONECLAW_DATA_DIR）");
                process.exitCode = 1;
                return;
            }
            console.log(JSON.stringify(events, null, 2));
        });

    trace
        .command("failed")
        .description("列出最近一段时间内的失败类事件")
        .option("-S, --since <dur>", "时间窗口，如 24h / 1d / 30m", "24h")
        .option("-t, --tool <name>", "仅保留指定 toolName")
        .option("-d, --days <n>", "最多扫描最近 N 个日志文件", "14")
        .action(async (opts: { since: string; tool?: string; days: string }) => {
            const ms = parseSinceToMs(opts.since);
            const sinceIso = new Date(Date.now() - ms).toISOString();
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));

            const all = await collectEventsSince(sinceIso, days);

            let rows = all.filter((e) => {
                if (e.eventType === "tool.failed") return true;
                if (e.eventType === "tool.denied") return true;
                if (e.eventType === "tool.validation.failed") return true;
                if (e.eventType === "tool.execute.end" && e.ok === false) return true;
                if (e.eventType === "session.end" && e.ok === false) return true;
                return false;
            });

            if (opts.tool?.trim()) {
                const t = opts.tool.trim();
                rows = rows.filter((e) => e.toolName === t);
            }

            console.log(JSON.stringify(rows, null, 2));
        });

    trace
        .command("slow")
        .description("按 tool.execute.end 的 durationMs 排序，取最慢 Top N")
        .option("-S, --since <dur>", "时间窗口", "24h")
        .option("-n, --top <n>", "条数", "20")
        .option("-d, --days <n>", "最多扫描最近 N 个日志文件", "14")
        .action(async (opts: { since: string; top: string; days: string }) => {
            const ms = parseSinceToMs(opts.since);
            const sinceIso = new Date(Date.now() - ms).toISOString();
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
            const top = Math.max(1, Math.min(500, Number(opts.top) || 20));

            const all = await collectEventsSince(sinceIso, days);
            const rows = all
                .filter(
                    (e) =>
                        e.eventType === "tool.execute.end" && typeof e.durationMs === "number"
                )
                .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
                .slice(0, top);

            console.log(JSON.stringify(rows, null, 2));
        });

    trace
        .command("replay")
        .description("按 traceId 输出可读时间线摘要（不重放执行）")
        .argument("[traceId]", "traceId")
        .option("-i, --id <traceId>", "traceId（与位置参数二选一）")
        .option("-d, --days <n>", "扫描最近 N 天", "14")
        .option("-j, --json", "输出 JSON 结构（便于脚本/前端消费）", false)
        .action(
            async (traceId: string | undefined, opts: { id?: string; days: string; json?: boolean }) => {
                const id = (traceId?.trim() || opts.id?.trim() || "").trim();
                if (!id) {
                    console.error(needTraceIdHint("trace replay"));
                    process.exitCode = 1;
                    return;
                }
                const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
                const events = await findEventsByTraceId(id, days);

                if (!events.length) {
                    console.error("未找到该 traceId");
                    process.exitCode = 1;
                    return;
                }

                const first = events[0];
                const last = events[events.length - 1];
                const totalMs = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();

                const llmReq = events.filter((e) => e.eventType === "llm.request").length;
                const llmResp = events.filter((e) => e.eventType === "llm.response").length;
                const toolResolve = events.filter((e) => e.eventType === "tool.resolve").length;
                const toolEnd = events.filter((e) => e.eventType === "tool.execute.end").length;
                const failed = events.filter(
                    (e) =>
                        e.eventType === "tool.failed" ||
                        e.eventType === "tool.denied" ||
                        e.eventType === "tool.validation.failed" ||
                        (e.eventType === "tool.execute.end" && e.ok === false)
                ).length;

                const summary = {
                    traceId: id,
                    timeRange: { start: first.timestamp, end: last.timestamp },
                    durationMs: totalMs,
                    sessionKey: first.sessionKey ?? null,
                    agentId: first.agentId ?? null,
                    channelId: first.channelId ?? null,
                    profileId: first.profileId ?? null,
                    counters: {
                        events: events.length,
                        llmRequest: llmReq,
                        llmResponse: llmResp,
                        toolResolve,
                        toolExecuteEnd: toolEnd,
                        failed,
                    },
                };

                if (opts.json) {
                    console.log(JSON.stringify({ summary, timeline: events }, null, 2));
                    return;
                }

                const header = [
                    `traceId: ${id}`,
                    `timeRange: ${first.timestamp} -> ${last.timestamp}`,
                    `durationMs: ${totalMs}`,
                    `sessionKey: ${first.sessionKey ?? "-"}`,
                    `agentId: ${first.agentId ?? "-"}`,
                    `channelId: ${first.channelId ?? "-"}`,
                    `profileId: ${first.profileId ?? "-"}`,
                    `events: ${events.length}, llm.request=${llmReq}, llm.response=${llmResp}, tool.resolve=${toolResolve}, tool.execute.end=${toolEnd}, failed=${failed}`,
                    "",
                    "Timeline:",
                ];

                const lines = events.map((e) => {
                    const base = `[${e.timestamp}] ${e.eventType}`;
                    const tool = e.toolName ? ` tool=${e.toolName}` : "";
                    const src = e.toolSource ? ` source=${e.toolSource}` : "";
                    const ok = typeof e.ok === "boolean" ? ` ok=${e.ok}` : "";
                    const dur = typeof e.durationMs === "number" ? ` durationMs=${e.durationMs}` : "";
                    const code = e.errorCode ? ` errorCode=${e.errorCode}` : "";
                    const attempt = typeof e.attempt === "number" ? ` attempt=${e.attempt}` : "";
                    return `${base}${tool}${src}${ok}${dur}${code}${attempt}`;
                });

                console.log([...header, ...lines].join("\n"));
            }
        );
}
