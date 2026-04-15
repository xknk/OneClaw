import { describe, expect, it } from "vitest";
import { shouldCreateParentDirForWrite } from "@/agent/tools/applyPatch";

describe("shouldCreateParentDirForWrite", () => {
    it("Windows 盘符根目录文件应跳过 mkdir", () => {
        expect(shouldCreateParentDirForWrite("D:\\time.txt")).toBe(false);
    });

    it("普通子目录文件应创建父目录", () => {
        expect(shouldCreateParentDirForWrite("D:\\work\\time.txt")).toBe(true);
    });
});

