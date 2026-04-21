/**
 * 在允许路径内创建/解压 zip（adm-zip）
 */

import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { resolveInWorkspace } from "./workspace";

const MAX_ZIP_BYTES = 80 * 1024 * 1024;

/**
 * 将多个文件或目录打包为 zip（同名文件会后者覆盖前者，建议路径不重复）
 */
export async function createZipInWorkspace(inputPaths: string[], outputZipRelative: string): Promise<string> {
    if (!inputPaths.length) {
        throw new Error("paths 不能为空");
    }
    const zip = new AdmZip();
    const normalized = [...new Set(inputPaths.map((p) => p.trim()).filter(Boolean))];
    for (const rel of normalized) {
        const full = resolveInWorkspace(rel, "read");
        const st = await fs.stat(full);
        if (st.isDirectory()) {
            zip.addLocalFolder(full, path.basename(path.resolve(full)) + "/");
        } else {
            zip.addLocalFile(full);
        }
    }
    const outFull = resolveInWorkspace(outputZipRelative.trim(), "write");
    await fs.mkdir(path.dirname(outFull), { recursive: true });
    zip.writeZip(outFull);
    return `已写入 zip: ${outputZipRelative}（${normalized.length} 项）`;
}

/**
 * 解压 zip 到目标目录（覆盖已存在文件）
 */
export async function extractZipInWorkspace(zipRelativePath: string, targetDirRelative: string): Promise<string> {
    const zipFull = resolveInWorkspace(zipRelativePath.trim(), "read");
    const buf = await fs.readFile(zipFull);
    if (buf.length > MAX_ZIP_BYTES) {
        throw new Error(`zip 超过 ${MAX_ZIP_BYTES} 字节上限，请分包或改用 exec（若允许）`);
    }
    const targetFull = resolveInWorkspace(targetDirRelative.trim(), "write");
    await fs.mkdir(targetFull, { recursive: true });
    const zip = new AdmZip(buf);
    zip.extractAllTo(targetFull, true);
    return `已解压到: ${targetDirRelative}`;
}
