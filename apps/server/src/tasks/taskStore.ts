import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appConfig } from "@/config/evn";
import type { ListTasksQuery, TaskRecord, TaskStatus } from "./types";

const TASK_INDEX_FILENAME = "tasks-index.json";

type TaskIndexEntry = { taskId: string; updatedAt: string; status: TaskStatus };
type TaskIndexFile = { version: 1; entries: TaskIndexEntry[] };

/**
 * 获取存储任务文件的根目录
 * 路径通常为：{数据目录}/tasks
 */
export function tasksRootDir(): string {
    return path.join(appConfig.dataDir, "tasks");
}

/**
 * 根据任务 ID 生成文件路径
 * 使用 encodeURIComponent 是为了防止 taskId 包含非法路径字符（如 / .. 等）
 */
function taskPath(taskId: string): string {
    return path.join(tasksRootDir(), `${encodeURIComponent(taskId)}.json`);
}

/**
 * 确保任务存储目录存在
 * { recursive: true } 相当于执行 `mkdir -p`
 */
export async function ensureTasksDir(): Promise<void> {
    await fs.mkdir(tasksRootDir(), { recursive: true });
}

/**
 * 将任务记录写入磁盘（采用原子写入策略）
 */
export async function writeTask(record: TaskRecord): Promise<void> {
    await ensureTasksDir();
    const file = taskPath(record.taskId);
    const tmp = `${file}.tmp`; // 先定义临时文件路径

    // 1. 将 JSON 数据写入临时文件 (.tmp)
    // 2. null, 2 表示美化输出，保留 2 空格缩进
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");

    // 3. 执行原子重命名操作 (rename)
    // 这种方式能防止写入过程中意外断电导致原 JSON 文件被写坏（损坏）
    await fs.rename(tmp, file);
    await upsertTaskIndex(record);
}

/**
 * 根据 ID 读取单个任务
 * 如果文件不存在返回 null，而不是抛出异常
 */
export async function readTask(taskId: string): Promise<TaskRecord | null> {
    try {
        const raw = await fs.readFile(taskPath(taskId), "utf-8");
        return JSON.parse(raw) as TaskRecord;
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        // ENOENT 表示 "Error NO ENTry"，即文件不存在
        if (err.code === "ENOENT") return null;
        throw e;
    }
}

/**
 * 永久删除任务文件（用于管理端清理）。
 */
export async function deleteTaskFile(taskId: string): Promise<boolean> {
    const file = taskPath(taskId.trim());
    try {
        await fs.unlink(file);
        await removeFromTaskIndex(taskId.trim());
        return true;
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return false;
        throw e;
    }
}

/**
 * 扫描目录，获取所有有效的 JSON 任务文件名
 * 过滤掉 .tmp 临时文件，防止读取到写入一半的数据
 */
export async function listTaskFiles(): Promise<string[]> {
    const root = tasksRootDir();
    try {
        const names = await fs.readdir(root);
        return names.filter(
            (n) =>
                n.endsWith(".json") &&
                !n.endsWith(".tmp") &&
                n !== TASK_INDEX_FILENAME
        );
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return [];
        throw e;
    }
}

function taskIndexPath(): string {
    return path.join(tasksRootDir(), TASK_INDEX_FILENAME);
}

async function readTaskIndex(): Promise<TaskIndexFile | null> {
    try {
        const raw = await fs.readFile(taskIndexPath(), "utf-8");
        const j = JSON.parse(raw) as TaskIndexFile;
        if (j?.version !== 1 || !Array.isArray(j.entries)) return null;
        return j;
    } catch {
        return null;
    }
}

async function writeTaskIndexAtomic(entries: TaskIndexEntry[]): Promise<void> {
    await ensureTasksDir();
    const file = taskIndexPath();
    const tmp = `${file}.tmp`;
    const body: TaskIndexFile = { version: 1, entries };
    await fs.writeFile(tmp, JSON.stringify(body, null, 2), "utf-8");
    await fs.rename(tmp, file);
}

/** 全量扫描任务文件重建索引（目录与索引不一致或缺失时调用） */
export async function rebuildTaskIndexFromDisk(): Promise<TaskIndexFile> {
    const files = await listTaskFiles();
    const entries: TaskIndexEntry[] = [];
    for (const f of files) {
        const id = decodeURIComponent(f.replace(/\.json$/, ""));
        const rec = await readTask(id);
        if (rec) {
            entries.push({ taskId: rec.taskId, updatedAt: rec.updatedAt, status: rec.status });
        }
    }
    entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    await writeTaskIndexAtomic(entries);
    return { version: 1, entries };
}

async function upsertTaskIndex(rec: TaskRecord): Promise<void> {
    let idx = await readTaskIndex();
    if (!idx) idx = { version: 1, entries: [] };
    const rest = idx.entries.filter((e) => e.taskId !== rec.taskId);
    rest.push({
        taskId: rec.taskId,
        updatedAt: rec.updatedAt,
        status: rec.status,
    });
    rest.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    await writeTaskIndexAtomic(rest);
}

async function removeFromTaskIndex(taskId: string): Promise<void> {
    const idx = await readTaskIndex();
    if (!idx) return;
    const next = idx.entries.filter((e) => e.taskId !== taskId);
    if (next.length === idx.entries.length) return;
    await writeTaskIndexAtomic(next);
}

/**
 * 根据查询条件获取任务列表并排序（优先 tasks-index.json，减少全量读盘）
 */
export async function listTasks(query: ListTasksQuery = {}): Promise<TaskRecord[]> {
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));

    let idx = await readTaskIndex();
    const files = await listTaskFiles();
    if (!idx || idx.entries.length !== files.length) {
        idx = await rebuildTaskIndexFromDisk();
    }

    let entries = [...idx.entries];
    if (query.status) {
        entries = entries.filter((e) => e.status === query.status);
    }
    if (query.failedOnly) {
        entries = entries.filter((e) => e.status === "failed");
    }
    entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

    const rows: TaskRecord[] = [];
    for (const e of entries.slice(0, limit)) {
        const rec = await readTask(e.taskId);
        if (rec) rows.push(rec);
    }
    return rows;
}

/**
 * 生成符合 UUID v4 标准的随机任务 ID
 */
export function newTaskId(): string {
    return randomUUID();
}
