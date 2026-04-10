import fs from "node:fs"; // 注意：流操作通常配合基础 fs 使用
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { appConfig } from "@/config/evn";
import type { TraceEvent } from "./traceTypes";

/** 与 traceWriter 一致：`trace-YYYY-MM-DD.jsonl` 或 `trace-YYYY-MM-DD-partN.jsonl` */
const TRACE_FILE_RE = /^trace-(\d{4}-\d{2}-\d{2})(?:-part\d+)?\.jsonl$/;

/** 获取日志目录 */
export function traceLogDir(): string {
    return path.join(appConfig.userWorkspaceDir, "logs", "trace");
}

/** 同日多段文件：主文件在前，part2、part3… 递增 */
function sortSameDayTraceFiles(prefix: string, a: string, b: string): number {
    const order = (n: string): number => {
        if (n === `${prefix}.jsonl`) return 0;
        const m = n.match(/-part(\d+)\.jsonl$/);
        return m ? Number(m[1]) : 999;
    };
    return order(a) - order(b);
}

/** 
 * 列出最近 N 个日历日内的全部 trace 文件路径（含同日轮转产生的 part 文件）
 */
export async function listTraceFiles(lastNDays = 14): Promise<string[]> {
    const dir = traceLogDir();
    try {
        const names = await fsp.readdir(dir);
        const byDate = new Map<string, string[]>();
        for (const n of names) {
            const m = n.match(TRACE_FILE_RE);
            if (!m) continue;
            const date = m[1];
            const arr = byDate.get(date) ?? [];
            arr.push(n);
            byDate.set(date, arr);
        }
        const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));
        const selectedDates = sortedDates.slice(0, lastNDays);
        const out: string[] = [];
        for (const d of selectedDates) {
            const prefix = `trace-${d}`;
            const files = (byDate.get(d) ?? []).sort((a, b) => sortSameDayTraceFiles(prefix, a, b));
            for (const n of files) {
                out.push(path.join(dir, n));
            }
        }
        return out;
    } catch {
        return [];
    }
}

/** 
 * 优化 2: 内存安全型迭代器
 * 使用 readline 接口逐行读取，不将整个文件载入内存
 */
async function* iterEvents(filePaths: string[]): AsyncGenerator<TraceEvent> {
    for (const p of filePaths) {
        // 检查文件是否存在
        if (!fs.existsSync(p)) continue;

        const fileStream = fs.createReadStream(p);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity, // 支持各种换行符
        });

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                // 直接 yield 结果，按需解析
                yield JSON.parse(trimmed) as TraceEvent;
            } catch {
                // 忽略损坏的 JSON 行
                continue;
            }
        }
    }
}

/** 
 * 按 traceId 提取链路
 */
export async function findEventsByTraceId(traceId: string, lastNDays = 14): Promise<TraceEvent[]> {
    const out: TraceEvent[] = [];
    const files = await listTraceFiles(lastNDays);

    for await (const ev of iterEvents(files)) {
        if (ev.traceId === traceId) {
            out.push(ev);
        }
    }

    // 链路追踪通常需要严格的时间轴顺序
    return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** 
 * 优化 3: 收集指定时间后的事件
 * 增加了简单的性能假设：如果文件是按天命名的且我们从最新文件开始读，
 * 理论上可以在遇到过旧数据时提前结束。
 */
export async function collectEventsSince(sinceIso: string, lastNDays = 14): Promise<TraceEvent[]> {
    const out: TraceEvent[] = [];
    const files = await listTraceFiles(lastNDays);

    for await (const ev of iterEvents(files)) {
        if (ev.timestamp >= sinceIso) {
            out.push(ev);
        } else {
            // 如果日志文件内部也是严格按时间顺序排列的，
            // 可以在此处直接 break 循环以节省 CPU。
            // 注：由于文件是按天倒序的，遇到小于 sinceIso 的行可以视情况停止。
        }
    }
    return out;
}
