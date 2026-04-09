import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appConfig } from "@/config/evn";
import type { ListTasksQuery, TaskRecord } from "./types";

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
 * 扫描目录，获取所有有效的 JSON 任务文件名
 * 过滤掉 .tmp 临时文件，防止读取到写入一半的数据
 */
export async function listTaskFiles(): Promise<string[]> {
    const root = tasksRootDir();
    try {
        const names = await fs.readdir(root);
        return names.filter((n) => n.endsWith(".json") && !n.endsWith(".tmp"));
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return [];
        throw e;
    }
}

/**
 * 根据查询条件获取任务列表并排序
 */
export async function listTasks(query: ListTasksQuery = {}): Promise<TaskRecord[]> {
    // 1. 设置合理的查询限制（1 到 200 之间，默认 50）
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    
    // 2. 获取目录下的所有文件名
    const files = await listTaskFiles();
    const rows: TaskRecord[] = [];

    // 3. 遍历并读取每个文件内容
    for (const f of files) {
        const id = decodeURIComponent(f.replace(/\.json$/, ""));
        const rec = await readTask(id);
        if (!rec) continue;

        // 4. 应用查询过滤逻辑
        if (query.status && rec.status !== query.status) continue;
        if (query.failedOnly && rec.status !== "failed") continue;
        
        rows.push(rec);
    }

    // 5. 按更新时间（updatedAt）降序排列（最新的在前面）
    rows.sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
    );

    // 6. 返回分页结果
    return rows.slice(0, limit);
}

/**
 * 生成符合 UUID v4 标准的随机任务 ID
 */
export function newTaskId(): string {
    return randomUUID();
}
