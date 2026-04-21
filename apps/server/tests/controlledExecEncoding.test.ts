import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";

describe("exec 输出编码（Windows OEM/GBK）", () => {
    it("cp936 字节可被正确解码为中文", () => {
        const buf = iconv.encode(" 驱动器 D 中的卷", "cp936");
        const s = iconv.decode(buf, "cp936");
        expect(s).toContain("驱动器");
    });
});
