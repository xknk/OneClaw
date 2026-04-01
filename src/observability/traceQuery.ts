import fs from "node:fs"; // 注意：流操作通常配合基础 fs 使用
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { appConfig } from "@/config/evn";
import type { TraceEvent } from "./traceTypes";

/** 获取日志目录 */
export function traceLogDir(): string {
    return path.join(appConfig.userWorkspaceDir, "logs", "trace");
}

/** 
 * 优化 1: 精简 listTraceFiles
 * 使用异步迭代器处理文件列表，减少数组拷贝
 */
export async function listTraceFiles(lastNDays = 14): Promise<string[]> {
    const dir = traceLogDir();
    try {
        const names = await fsp.readdir(dir);
        return names
            .filter((n) => n.startsWith("trace-") && n.endsWith(".jsonl"))
            // 直接利用日期字符串排序，性能更高
            .sort((a, b) => b.localeCompare(a))
            .slice(0, lastNDays)
            .map((n) => path.join(dir, n));
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
