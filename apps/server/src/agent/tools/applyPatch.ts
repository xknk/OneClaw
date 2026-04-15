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
  const dir = path.dirname(fullPath);
  const root = path.parse(dir).root;
  return !(root && dir === root);
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
