/**
 * workspace 内路径解析与文件操作（read / write / delete / move / copy / mkdir 等）
 * 安全原则：全局允许根 + 拒绝前缀 + pathRules 级别（read / write / full）
 */

import fs from "fs/promises";
import path from "path";
import type { Dirent } from "fs";
import { createHash } from "node:crypto";
import { appConfig } from "../../config/evn";
import { FileContentLru } from "../../infra/fileContentLru";
import {
    assertPathOperationAllowed,
    ensureFileAccessPolicyReady,
    getFileAccessDeniedPrefixes as getPolicyDeniedPrefixes,
    getFileAccessRoots as getPolicyRoots,
    isPathGloballyAllowed,
} from "../../config/fileAccessPolicy";

let readFileContentLru: FileContentLru | null = null;
function getReadFileLru(): FileContentLru {
    if (!readFileContentLru) {
        readFileContentLru = new FileContentLru(appConfig.readFileLruMaxEntries);
    }
    return readFileContentLru;
}

/**
 * 获取主 workspace 绝对根路径（相对路径仍解析到此根下）
 */
export function getUserWorkspaceRoot(): string {
    return path.resolve(appConfig.userWorkspaceDir);
}

/**
 * 所有允许的文件访问根（含主 workspace 与额外配置的根）
 */
export function getFileAccessRoots(): readonly string[] {
    ensureFileAccessPolicyReady();
    return getPolicyRoots();
}

/**
 * 判断 candidate 是否落在 root 之下或与 root 相同（root 为已 resolve 的绝对路径）
 */
export function isPathInsideRoot(rootResolved: string, candidateResolved: string): boolean {
    const root = path.resolve(rootResolved);
    const cand = path.resolve(candidateResolved);
    if (cand === root) return true;
    const rel = path.relative(root, cand);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * 将相对路径解析为绝对路径（相对主 workspace），或接受已落在允许范围内的绝对路径
 * @param purpose read=读/搜索；write=写入；delete=删除文件
 */
export function resolveInWorkspace(
    relativeOrAbsolute: string,
    purpose: "read" | "write" | "delete" = "read",
): string {
    const primary = getUserWorkspaceRoot();
    const resolved = path.isAbsolute(relativeOrAbsolute)
        ? path.resolve(relativeOrAbsolute)
        : path.resolve(primary, relativeOrAbsolute);
    assertPathOperationAllowed(resolved, relativeOrAbsolute, purpose);
    return resolved;
}

/**
 * 读取工作区内文件内容
 */
export async function readFileInWorkspace(relativePath: string): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "read");
    const stat = await fs.stat(fullPath);

    if (!stat.isFile()) {
        throw new Error(`不是文件: ${relativePath}`);
    }
    const cacheKey = `${fullPath}:${stat.mtimeMs}`;
    const hit = getReadFileLru().get(cacheKey);
    if (hit !== undefined) return hit;
    const content = await fs.readFile(fullPath, "utf-8");
    getReadFileLru().set(cacheKey, content);
    return content;
}

const MAX_READ_RANGE_LINES = 8000;

/**
 * 按行读取文件片段（1-based 行号，含首尾）。不传 line_end 时最多读 MAX_READ_RANGE_LINES 行。
 */
export async function readFileRangeInWorkspace(
    relativePath: string,
    lineStart: number,
    lineEndInclusive?: number,
): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "read");
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
        throw new Error(`不是文件: ${relativePath}`);
    }
    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const start = Math.max(1, Math.floor(lineStart));
    const end =
        lineEndInclusive !== undefined
            ? Math.min(lines.length, Math.max(start, Math.floor(lineEndInclusive)))
            : Math.min(lines.length, start + MAX_READ_RANGE_LINES - 1);
    if (start > lines.length) {
        return `（空范围：文件共 ${lines.length} 行，line_start=${start}）`;
    }
    const slice = lines.slice(start - 1, end);
    const header = `lines ${start}-${Math.min(end, start + slice.length - 1)} of ${lines.length} (${relativePath})\n\n`;
    return header + slice.join("\n");
}

/**
 * 计算文件哈希（整文件读入；大文件请注意体积）
 */
export async function hashFileInWorkspace(relativePath: string, algorithm: "sha256" | "md5"): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "read");
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
        throw new Error(`不是文件: ${relativePath}`);
    }
    const buf = await fs.readFile(fullPath);
    const h = createHash(algorithm).update(buf).digest("hex");
    return `${algorithm.toUpperCase()}\t${h}\tbytes=${buf.length}\t${relativePath}`;
}

/**
 * 删除工作区内文件（需路径级 full 权限）
 */
export async function deleteFileInWorkspace(relativePath: string): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "delete");
    await fs.unlink(fullPath);
    return `已删除 ${relativePath}`;
}

/**
 * 移动或重命名文件/目录（同卷 rename；跨卷见错误提示）
 */
export async function movePathInWorkspace(fromRel: string, toRel: string): Promise<string> {
    const fromFull = resolveInWorkspace(fromRel, "delete");
    const toFull = resolveInWorkspace(toRel, "write");
    const st = await fs.stat(fromFull);
    const toParent = path.dirname(toFull);
    await fs.mkdir(toParent, { recursive: true });
    try {
        await fs.rename(fromFull, toFull);
    } catch (e: unknown) {
        const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : "";
        if (code === "EXDEV") {
            throw new Error(
                "无法跨卷移动。请改用 copy_file（必要时 recursive）复制到目标后，再 delete_file 删除源路径。"
            );
        }
        throw e;
    }
    const kind = st.isDirectory() ? "目录" : "文件";
    return `已移动${kind}：${fromRel} → ${toRel}`;
}

/**
 * 复制文件，或递归复制目录（recursive=true）
 */
export async function copyPathInWorkspace(fromRel: string, toRel: string, recursive = false): Promise<string> {
    const fromFull = resolveInWorkspace(fromRel, "read");
    const toFull = resolveInWorkspace(toRel, "write");
    const st = await fs.stat(fromFull);
    const toParent = path.dirname(toFull);
    await fs.mkdir(toParent, { recursive: true });
    if (st.isFile()) {
        await fs.copyFile(fromFull, toFull);
        return `已复制文件：${fromRel} → ${toRel}`;
    }
    if (st.isDirectory()) {
        if (!recursive) {
            throw new Error("源为目录时请设 recursive=true，或改用 exec 的 robocopy/xcopy（若策略允许）");
        }
        await fs.cp(fromFull, toFull, { recursive: true });
        return `已递归复制目录：${fromRel} → ${toRel}`;
    }
    throw new Error(`不支持的类型: ${fromRel}`);
}

/**
 * 创建目录（recursive 默认 true，等价 mkdir -p）
 */
export async function makeDirectoryInWorkspace(relativePath: string, recursive = true): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "write");
    await fs.mkdir(fullPath, { recursive });
    return `已创建目录：${relativePath}`;
}

/**
 * 查询文件或目录元数据（大小、mtime、权限位等）
 */
export async function statPathInWorkspace(relativePath: string): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "read");
    const st = await fs.stat(fullPath);
    const kind = st.isDirectory() ? "directory" : st.isFile() ? "file" : "other";
    const modeOct = (st.mode & 0o777).toString(8).padStart(3, "0");
    const lines = [
        `path: ${relativePath}`,
        `kind: ${kind}`,
        `size: ${st.size}`,
        `mtimeMs: ${st.mtimeMs}`,
        `mode: 0o${modeOct}`,
        `isSymbolicLink: ${st.isSymbolicLink()}`,
    ];
    return lines.join("\n");
}

export type BatchFileOp =
    | { op: "delete"; path: string }
    | { op: "move"; from: string; to: string }
    | { op: "copy"; from: string; to: string; recursive?: boolean }
    | { op: "mkdir"; path: string; recursive?: boolean };

const MAX_BATCH_OPS = 30;

/**
 * 在同一轮中顺序执行多条文件操作（任意一步失败则中止并抛出，已执行项已完成）
 */
export async function batchFileOperationsInWorkspace(items: BatchFileOp[]): Promise<string> {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("operations 须为非空数组");
    }
    if (items.length > MAX_BATCH_OPS) {
        throw new Error(`批量操作最多 ${MAX_BATCH_OPS} 条`);
    }
    const lines: string[] = [];
    let step = 0;
    for (const raw of items) {
        step++;
        if (!raw || typeof raw !== "object" || typeof (raw as { op?: unknown }).op !== "string") {
            throw new Error(`第 ${step} 条：缺少 op`);
        }
        const op = (raw as { op: string }).op;
        if (op === "delete") {
            const p = typeof (raw as { path?: unknown }).path === "string" ? (raw as { path: string }).path : "";
            if (!p.trim()) throw new Error(`第 ${step} 条 delete：需要 path`);
            lines.push(`${step}. ${await deleteFileInWorkspace(p)}`);
            continue;
        }
        if (op === "move") {
            const from =
                typeof (raw as { from?: unknown }).from === "string" ? (raw as { from: string }).from : "";
            const to = typeof (raw as { to?: unknown }).to === "string" ? (raw as { to: string }).to : "";
            if (!from.trim() || !to.trim()) throw new Error(`第 ${step} 条 move：需要 from 与 to`);
            lines.push(`${step}. ${await movePathInWorkspace(from, to)}`);
            continue;
        }
        if (op === "copy") {
            const from =
                typeof (raw as { from?: unknown }).from === "string" ? (raw as { from: string }).from : "";
            const to = typeof (raw as { to?: unknown }).to === "string" ? (raw as { to: string }).to : "";
            const rec = (raw as { recursive?: unknown }).recursive === true;
            if (!from.trim() || !to.trim()) throw new Error(`第 ${step} 条 copy：需要 from 与 to`);
            lines.push(`${step}. ${await copyPathInWorkspace(from, to, rec)}`);
            continue;
        }
        if (op === "mkdir") {
            const p = typeof (raw as { path?: unknown }).path === "string" ? (raw as { path: string }).path : "";
            const rec = (raw as { recursive?: unknown }).recursive !== false;
            if (!p.trim()) throw new Error(`第 ${step} 条 mkdir：需要 path`);
            lines.push(`${step}. ${await makeDirectoryInWorkspace(p, rec)}`);
            continue;
        }
        throw new Error(`第 ${step} 条：未知 op「${op}」（支持 delete | move | copy | mkdir）`);
    }
    return lines.join("\n");
}

/**
 * 列出工作区内某目录的直接子项（不递归）。path 空或 "." 表示主 workspace 根。
 */
export async function listDirInWorkspace(relativePath: string, maxEntries = 200): Promise<string> {
    const safe = relativePath.trim() === "" ? "." : relativePath;
    const fullPath = resolveInWorkspace(safe, "read");
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) {
        throw new Error(`不是目录: ${safe}`);
    }
    const cap = Math.min(Math.max(1, Math.floor(maxEntries)), 500);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name, "en"));
    const lines: string[] = [];
    for (let i = 0; i < sorted.length && i < cap; i++) {
        const e = sorted[i]!;
        const tag = e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";
        lines.push(`${tag}\t${e.name}`);
    }
    if (sorted.length > cap) {
        lines.push(`… 共 ${sorted.length} 项，已截断为 ${cap} 项（可调 max_entries）`);
    }
    return lines.length ? lines.join("\n") : "（空目录）";
}

function shouldSkipDirForWalk(absDir: string): boolean {
    return getPolicyDeniedPrefixes().some((d) => isPathInsideRoot(d, absDir));
}

/**
 * 在工作区内搜索文件（支持文件名匹配和内容关键字匹配）
 * 多根时结果为绝对路径；单根时仍为相对主 workspace 的路径
 */
export async function searchInWorkspace(
    glob: string = "**/*",
    contentSubstring?: string
): Promise<string[]> {
    const roots = [...getPolicyRoots()];
    const primary = getUserWorkspaceRoot();
    const multiRoot = roots.length > 1;
    const results: string[] = [];

    async function walk(dir: string, walkRoot: string): Promise<void> {
        const absDir = path.resolve(dir);
        if (shouldSkipDirForWalk(absDir)) return;

        let entries: Dirent[];
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const e of entries) {
            const full = path.join(absDir, e.name);
            if (e.isDirectory()) {
                await walk(full, walkRoot);
            } else if (e.isFile()) {
                if (!isPathGloballyAllowed(full)) continue;

                const rel = path.relative(walkRoot, full);
                if (!glob || glob === "**/*" || matchSimpleGlob(rel, glob)) {
                    if (contentSubstring) {
                        try {
                            const content = await fs.readFile(full, "utf-8");
                            if (content.includes(contentSubstring)) {
                                results.push(multiRoot ? full : rel);
                            }
                        } catch {
                            // 二进制或编码问题
                        }
                    } else {
                        results.push(multiRoot ? full : rel);
                    }
                }
            }
        }
    }

    for (const root of roots) {
        const r = path.resolve(root);
        if (shouldSkipDirForWalk(r)) continue;
        await walk(r, multiRoot ? r : primary);
    }

    return [...new Set(results)].sort();
}

function matchSimpleGlob(filePath: string, pattern: string): boolean {
    if (pattern === "*") return !filePath.includes(path.sep);

    if (pattern.startsWith("*.")) {
        return filePath.endsWith(pattern.slice(1));
    }

    return filePath.includes(pattern);
}
