/**
 * 在 workspace 内写入文件（MVP：最小可行性产品实现）
 * 功能：支持整文件替换或在末尾追加内容，默认仅限 workspace 内部操作
 */

import fs from "fs/promises";
import path from "path";
import { resolveInWorkspace, getUserWorkspaceRoot } from "./workspace";

// 定义写入模式：replace (替换/覆盖), append (追加)
export type ApplyPatchMode = "replace" | "append";

// 定义参数接口
export interface ApplyPatchOptions {
  path: string;          // 目标文件路径（相对于 workspace 根目录）
  content: string;       // 要写入的具体文本内容
  mode?: ApplyPatchMode; // 写入模式，默认为 "replace"
}

/**
 * 执行文件写入或修改操作
 * @param options 包含路径、内容和模式的配置对象
 * @returns 操作结果描述字符串
 */
export async function applyPatch(options: ApplyPatchOptions): Promise<string> {
  const { path: relativePath, content, mode = "replace" } = options;
  
  // 1. 解析绝对路径并执行初步安全校验
  const fullPath = resolveInWorkspace(relativePath);
  const root = getUserWorkspaceRoot();
  
  // 如果想写文件白名单，可在此处写
  
  // 2. 二次校验：确保最终生成的路径绝对不会越出工作区根目录
  if (!fullPath.startsWith(root)) {
    throw new Error("apply_patch 仅允许在 workspace 内写入");
  }

  // 3. 自动创建父级目录
  // 例如写入 'a/b/c.txt'，如果文件夹 'a' 或 'b' 不存在，则递归创建它们
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });

  // 4. 根据模式执行写入
  if (mode === "append") {
    // 追加模式：将内容添加到文件末尾
    await fs.appendFile(fullPath, content, "utf-8");
    return `已追加到 ${relativePath}`;
  }
  
  // 覆盖模式：直接写入内容，若文件已存在则内容会被全部替换
  await fs.writeFile(fullPath, content, "utf-8");
  return `已写入 ${relativePath}`;
}
