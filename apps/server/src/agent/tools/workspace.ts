/**
 * workspace 内路径解析与只读操作（read / search）
 * 安全原则：所有路径限制在 workspace 根目录内，禁止 ../ 越界访问系统文件
 */

import fs from "fs/promises";
import path from "path";
import type { Dirent } from "fs";
import { appConfig } from "../../config/evn";

/**
 * 获取经过解析的工作区绝对根路径
 */
export function getUserWorkspaceRoot(): string {
    // path.resolve 会将配置中的路径转为标准绝对路径
    return path.resolve(appConfig.userWorkspaceDir);
}

/**
 * 将相对路径解析为绝对路径，并执行越界检查
 * @param relativePath 相对工作区根目录的路径
 * @throws 当路径指向工作区外部时抛出错误
 */
export function resolveInWorkspace(relativePath: string): string {
    const root = getUserWorkspaceRoot();
    // 结合根路径和相对路径。注意：path.resolve 会自动计算 ".." 
    const resolved = path.resolve(root, relativePath);
    
    // 关键安全检查：解析后的绝对路径必须以工作区根路径开头
    if (!resolved.startsWith(root)) {
        throw new Error(`路径不允许越出 workspace: ${relativePath}`);
    }
    return resolved;
}

/**
 * 读取工作区内文件内容
 * @param relativePath 相对路径
 * @returns 文件 UTF-8 字符串内容
 */
export async function readFileInWorkspace(relativePath: string): Promise<string> {
    const fullPath = resolveInWorkspace(relativePath);
    const stat = await fs.stat(fullPath);
    
    // 确保读取的是文件而不是目录
    if (!stat.isFile()) {
        throw new Error(`不是文件: ${relativePath}`);
    }
    return fs.readFile(fullPath, "utf-8");
}

/**
 * 在工作区内搜索文件（支持文件名匹配和内容关键字匹配）
 * @param glob 匹配模式，如 "*.ts"、"src/" 或 "**//*" (全部)
 * @param contentSubstring 选填，若提供则执行全文检索，仅返回包含该字符串的文件
 */
export async function searchInWorkspace(
    glob: string = "**/*",
    contentSubstring?: string
): Promise<string[]> {
    const root = getUserWorkspaceRoot();
    const results: string[] = [];

    /**
     * 内部递归遍历函数
     * @param dir 当前遍历的绝对路径
     * @param baseDir 工作区根路径（用于计算相对路径）
     */
    async function walk(dir: string, baseDir: string): Promise<void> {
        let entries: Dirent[];
        try {
            // 读取目录，withFileTypes: true 可以直接获取类型，无需额外执行 stat
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            // 如果目录不可读（如权限问题），静默跳过
            return;
        }

        for (const e of entries) {
            const full = path.join(dir, e.name);
            const rel = path.relative(baseDir, full); // 获取相对于工作区的路径
            
            if (e.isDirectory()) {
                // 如果是目录，递归向下遍历
                await walk(full, baseDir);
            } else if (e.isFile()) {
                // 1. 首先检查文件名/路径是否符合 glob 规则
                if (!glob || glob === "**/*" || matchSimpleGlob(rel, glob)) {
                    // 2. 如果指定了内容关键字，则读取文件进行检索
                    if (contentSubstring) {
                        try {
                            const content = await fs.readFile(full, "utf-8");
                            if (content.includes(contentSubstring)) {
                                results.push(rel);
                            }
                        } catch {
                            // 失败通常是因为遇到大型二进制文件或编码问题，直接跳过
                        }
                    } else {
                        // 仅匹配文件名成功，直接存入结果
                        results.push(rel);
                    }
                }
            }
        }
    }

    await walk(root, root);
    return results.sort(); // 返回排序后的路径列表
}

/**
 * 极简版 Glob 匹配工具
 * @param filePath 相对于工作区的路径
 * @param pattern 匹配规则
 */
function matchSimpleGlob(filePath: string, pattern: string): boolean {
    // 模式为 "*"：只匹配根目录下的文件，不匹配子目录里的
    if (pattern === "*") return !filePath.includes(path.sep);
    
    // 模式为 "*.ext"：检查文件后缀
    if (pattern.startsWith("*.")) {
        return filePath.endsWith(pattern.slice(1));
    }
    
    // 默认行为：简单的包含匹配
    return filePath.includes(pattern);
}
