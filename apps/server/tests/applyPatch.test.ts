import { describe, expect, it } from "vitest";
import { shouldCreateParentDirForWrite } from "@/agent/tools/applyPatch";
import path from "path";

describe("shouldCreateParentDirForWrite", () => {
    it("Windows 盘符根目录文件应跳过 mkdir", () => {
        // 💡 如果你的源代码里用了普通的 import path from 'path'
        // 那么在 Linux CI 上运行这段测试时，它依然会按 Linux 逻辑解析
        expect(shouldCreateParentDirForWrite("D:\\time.txt")).toBe(false);
    });

    it("普通子目录文件应创建父目录", () => {
        expect(shouldCreateParentDirForWrite("D:\\work\\time.txt")).toBe(true);
    });
});
