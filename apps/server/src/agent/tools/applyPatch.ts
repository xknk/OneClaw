/**
 * 在允许的文件访问根内写入（MVP）
 * 支持整文件替换或追加；路径规则见 workspace.ts 与 fileAccessPolicy
 */

import fs from "fs/promises";
import path from "path";
import { resolveInWorkspace } from "./workspace";

// 定义写入模式：replace (替换/覆盖), append (追加)
export type ApplyPatchMode = "replace" | "append";

// 定义参数接口
export interface ApplyPatchOptions {
  path: string;          // 目标文件路径（相对于 workspace 根目录）
  content: string;       // 要写入的具体文本内容
  mode?: ApplyPatchMode; // 写入模式，默认为 "replace"
}

export function shouldCreateParentDirForWrite(fullPath: string): boolean {
  // 1. 统一处理：将所有的反斜杠 \ 转为正斜杠 /，方便在任何系统下统一判断
  const unifiedPath = fullPath.replace(/\\/g, '/');
  
  // 2. 获取目录部分
  const lastSlashIndex = unifiedPath.lastIndexOf('/');
  if (lastSlashIndex === -1) return false; // 就在当前目录，不需要创建父目录

  const dir = unifiedPath.substring(0, lastSlashIndex);

  // 3. 判断是否为根目录
  // 情况 A: Unix/Linux 根目录 "/"
  if (dir === "" || dir === "/") return false;

  // 情况 B: Windows 盘符根目录 "C:" 或 "D:"
  // 注意：unifiedPath 转换后，D:\ 变成了 D:
  if (/^[a-zA-Z]:$/.test(dir)) return false;

  // 情况 C: 如果 dir 包含更深层级（如 "D:/work" 或 "a/b"），则需要创建
  return true;
}


/**
 * 执行文件写入或修改操作
 * @param options 包含路径、内容和模式的配置对象
 * @returns 操作结果描述字符串
 */
export async function applyPatch(options: ApplyPatchOptions): Promise<string> {
  const { path: relativePath, content, mode = "replace" } = options;
  
  const fullPath = resolveInWorkspace(relativePath, "write");

  // 自动创建父级目录
  // 例如写入 'a/b/c.txt'，如果文件夹 'a' 或 'b' 不存在，则递归创建它们
  const dir = path.dirname(fullPath);
  if (shouldCreateParentDirForWrite(fullPath)) {
    await fs.mkdir(dir, { recursive: true });
  }

  // 根据模式执行写入
  if (mode === "append") {
    // 追加模式：将内容添加到文件末尾
    await fs.appendFile(fullPath, content, "utf-8");
    return `已追加到 ${relativePath}`;
  }
  
  // 覆盖模式：直接写入内容，若文件已存在则内容会被全部替换
  await fs.writeFile(fullPath, content, "utf-8");
  return `已写入 ${relativePath}`;
}
