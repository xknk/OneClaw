import { Command } from "commander";
import {
    collectEventsSince,
    findEventsByTraceId,
    traceLogDir,
} from "@/observability/traceQuery";

/** 
 * 解析时间跨度字符串并转换为毫秒数
 * 支持格式: 24h (小时), 1d (天), 30m (分钟), 120s (秒)
 */
export function parseSinceToMs(s: string): number {
    // 正则解释：^(\d+) 匹配开头的数字，(h|d|m|s)$ 匹配结尾的单位，i 忽略大小写
    const m = String(s).trim().match(/^(\d+)(h|d|m|s)$/i);
    if (!m) {
        throw new Error(`无效的 --since 格式: ${s}（示例: 24h, 1d, 30m）`);
    }
    const n = Number(m[1]);          // 提取数字部分
    const u = m[2].toLowerCase();    // 提取单位部分

    // 按单位计算总毫秒数
    if (u === "h") return n * 3_600_000;
    if (u === "d") return n * 86_400_000;
    if (u === "m") return n * 60_000;
    return n * 1000; // 默认 s
}

/**
 * 注册所有与 Trace 相关的命令行指令
 * @param program Commander 的主程序实例
 */
export function registerTraceCommands(program: Command): void {
    // 创建 trace 一级命令
    const trace = program.command("trace").description("Trace 查询与诊断（JSONL）");

    /**
     * 子命令：trace dir
     * 用途：快速查看日志文件存放在哪个目录下，方便手动去文件夹中查找
     */
    trace
        .command("dir")
        .description("打印 trace 日志目录")
        .action(() => {
            console.log(traceLogDir());
        });

    /**
     * 子命令：trace get
     * 用途：根据唯一的 traceId 提取整条调用链的所有详细日志，并以 JSON 数组形式打印
     */
    trace
        .command("get")
        .description("按 traceId 输出完整事件链（JSON 数组）")
        .requiredOption("--id <traceId>", "traceId（与响应 metadata 中一致）")
        .option("--days <n>", "扫描最近 N 天的日志文件", "14")
        .action(async (opts: { id: string; days: string }) => {
            // 安全限制天数范围在 1~90 天，防止输入过大导致内存溢出
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
            const events = await findEventsByTraceId(opts.id.trim(), days);

            if (!events.length) {
                console.error("未找到该 traceId（请确认目录与天数，或检查 ONECLAW_DATA_DIR）");
                process.exitCode = 1;
                return;
            }
            // 格式化输出 JSON，缩进 2 空格
            console.log(JSON.stringify(events, null, 2));
        });

    /**
     * 子命令：trace failed
     * 用途：快速列出最近一段时间内的报错、拒绝或异常结束的事件，支持按工具名过滤
     */
    trace
        .command("failed")
        .description("列出最近一段时间内的失败类事件")
        .option("--since <dur>", "时间窗口，如 24h / 1d / 30m", "24h")
        .option("--tool <name>", "仅保留指定 toolName")
        .option("--days <n>", "最多扫描最近 N 个日志文件", "14")
        .action(async (opts: { since: string; tool?: string; days: string }) => {
            const ms = parseSinceToMs(opts.since);
            // 计算起始时间的 ISO 字符串（如 "2023-10-27T10:00:00.000Z"）
            const sinceIso = new Date(Date.now() - ms).toISOString();
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));

            // 获取时间范围内的所有原始事件
            const all = await collectEventsSince(sinceIso, days);

            // 定义“失败”事件的筛选标准
            let rows = all.filter((e) => {
                // 1. 显式的失败/拒绝类型
                if (e.eventType === "tool.failed") return true;
                if (e.eventType === "tool.denied") return true;
                if (e.eventType === "tool.validation.failed") return true;
                // 2. 正常结束但 ok 标记为 false 的情况
                if (e.eventType === "tool.execute.end" && e.ok === false) return true;
                if (e.eventType === "session.end" && e.ok === false) return true;
                return false;
            });

            // 如果用户传了 --tool，则进一步筛选特定工具的报错
            if (opts.tool?.trim()) {
                const t = opts.tool.trim();
                rows = rows.filter((e) => e.toolName === t);
            }

            console.log(JSON.stringify(rows, null, 2));
        });

    /**
     * 子命令：trace slow
     * 用途：性能调优，找出最近一段时间内响应最慢的工具调用
     */
    trace
        .command("slow")
        .description("按 tool.execute.end 的 durationMs 排序，取最慢 Top N")
        .option("--since <dur>", "时间窗口", "24h")
        .option("--top <n>", "条数", "20")
        .option("--days <n>", "最多扫描最近 N 个日志文件", "14")
        .action(async (opts: { since: string; top: string; days: string }) => {
            const ms = parseSinceToMs(opts.since);
            const sinceIso = new Date(Date.now() - ms).toISOString();
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
            const top = Math.max(1, Math.min(500, Number(opts.top) || 20));

            const all = await collectEventsSince(sinceIso, days);
            const rows = all
                .filter(
                    (e) =>
                        // 仅对带有“执行时长”字段的结束事件进行统计
                        e.eventType === "tool.execute.end" &&
                        typeof e.durationMs === "number"
                )
                // 按耗时降序排列（最慢的排在数组前面）
                .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
                // 截取前 N 条
                .slice(0, top);

            console.log(JSON.stringify(rows, null, 2));
        });

    /**
     * 子命令：trace replay
     * 用途：按 traceId 输出可读时间线摘要（不重放执行）
     */
    trace
        .command("replay")
        .description("按 traceId 输出可读时间线摘要（不重放执行）")
        .requiredOption("--id <traceId>", "traceId")
        .option("--days <n>", "扫描最近 N 天", "14")
        .action(async (opts: { id: string; days: string }) => {
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
            const events = await findEventsByTraceId(opts.id.trim(), days);

            if (!events.length) {
                console.error("未找到该 traceId");
                process.exitCode = 1;
                return;
            }

            const first = events[0];
            const last = events[events.length - 1];
            const totalMs =
                new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();

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

            const header = [
                `traceId: ${opts.id.trim()}`,
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
        });

    /**
     * 子命令：trace replay
     * 用途：按 traceId 输出可读时间线摘要（不重放执行）
     */
    trace
        .command("replay")
        .description("按 traceId 输出可读时间线摘要（不重放执行）")
        .requiredOption("--id <traceId>", "traceId")
        .option("--days <n>", "扫描最近 N 天", "14")
        .option("--json", "输出 JSON 结构（便于脚本/前端消费）", false)
        .action(async (opts: { id: string; days: string; json?: boolean }) => {
            const days = Math.max(1, Math.min(90, Number(opts.days) || 14));
            const traceId = opts.id.trim();
            const events = await findEventsByTraceId(traceId, days);

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
                traceId,
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
                `traceId: ${traceId}`,
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
        });
}
