import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "@/config/evn";
import type { TraceEvent } from "./traceTypes";

/**
 * 生成基于当前本地日期的主文件名
 * 格式: trace-2023-10-27.jsonl
 */
function todayFileName(date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `trace-${y}-${m}-${d}.jsonl`;
}

function dateKeyFromDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function traceDir(): string {
    return path.join(appConfig.userWorkspaceDir, "logs", "trace");
}

/** 同日多段文件排序：主文件 → part2 → part3… */
function sortSameDayParts(prefix: string, a: string, b: string): number {
    const order = (n: string): number => {
        if (n === `${prefix}.jsonl`) return 0;
        const m = n.match(/-part(\d+)\.jsonl$/);
        return m ? Number(m[1]) : 999;
    };
    return order(a) - order(b);
}

let appendTargetCache: { dateKey: string; path: string } | null = null;
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 选择当日可追加的 JSONL 路径；超过 traceFileMaxBytes 时新建 part 文件。
 */
async function resolveAppendPath(
    dir: string,
    dateKey: string,
    lineBytes: number
): Promise<string> {
    const max = appConfig.traceFileMaxBytes;
    const prefix = `trace-${dateKey}`;

    const cache = appendTargetCache;
    if (cache && cache.dateKey === dateKey && cache.path) {
        try {
            const st = await fs.stat(cache.path);
            if (st.size + lineBytes <= max) return cache.path;
        } catch {
            appendTargetCache = null;
        }
    }

    const entries = await fs.readdir(dir);
    const parts = entries
        .filter((n) => n.startsWith(prefix) && n.endsWith(".jsonl"))
        .sort((a, b) => sortSameDayParts(prefix, a, b));

    for (const name of parts) {
        const p = path.join(dir, name);
        const st = await fs.stat(p);
        if (st.size + lineBytes <= max) return p;
    }

    const nextPart = parts.length + 1;
    if (nextPart === 1) return path.join(dir, `${prefix}.jsonl`);
    return path.join(dir, `${prefix}-part${nextPart}.jsonl`);
}

/**
 * 删除文件名日期早于「今天 − retentionDays」的 trace 文件。
 */
export async function cleanupOldTraceFiles(): Promise<number> {
    const dir = traceDir();
    const retention = Math.max(1, appConfig.traceRetentionDays);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - retention);

    let deleted = 0;
    let names: string[];
    try {
        names = await fs.readdir(dir);
    } catch {
        return 0;
    }

    const re = /^trace-(\d{4}-\d{2}-\d{2})(?:-part\d+)?\.jsonl$/;
    for (const name of names) {
        const m = name.match(re);
        if (!m) continue;
        const fileDay = new Date(`${m[1]}T00:00:00`);
        if (fileDay < cutoff) {
            try {
                await fs.unlink(path.join(dir, name));
                deleted += 1;
            } catch {
                // ignore
            }
        }
    }
    return deleted;
}

async function maybeCleanupAfterAppend(): Promise<void> {
    const now = Date.now();
    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    lastCleanupAt = now;
    try {
        await cleanupOldTraceFiles();
    } catch {
        // ignore
    }
}

/**
 * 将追踪事件追加到当天的日志文件（JSONL）
 */
export async function appendTraceEvent(event: TraceEvent): Promise<void> {
    const dir = traceDir();
    await fs.mkdir(dir, { recursive: true });

    const line = JSON.stringify(event) + "\n";
    const lineBytes = Buffer.byteLength(line, "utf8");
    const dk = dateKeyFromDate(new Date());

    const file = await resolveAppendPath(dir, dk, lineBytes);
    appendTargetCache = { dateKey: dk, path: file };

    await fs.appendFile(file, line, "utf-8");
    void maybeCleanupAfterAppend();
}

/** @internal 供测试：重置轮转缓存（避免用例间互相影响） */
export function resetTraceWriterCacheForTests(): void {
    appendTargetCache = null;
    lastCleanupAt = 0;
}
