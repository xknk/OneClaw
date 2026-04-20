/**
 * workspace 内路径解析与只读操作（read / search / delete）
 * 安全原则：全局允许根 + 拒绝前缀 + pathRules 级别（read / write / full）
 */

import fs from "fs/promises";
import path from "path";
import type { Dirent } from "fs";
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

/**
 * 删除工作区内文件（需路径级 full 权限）
 */
export async function deleteFileInWorkspace(relativePath: string): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath, "delete");
    await fs.unlink(fullPath);
    return `已删除 ${relativePath}`;
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
