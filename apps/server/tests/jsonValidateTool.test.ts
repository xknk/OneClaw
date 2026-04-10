import { describe, it, expect } from "vitest";
import { getTool } from "@/agent/tools";

describe("json_validate builtin", () => {
    it("pretty 输出格式化 JSON", async () => {
        const t = getTool("json_validate");
        expect(t).toBeDefined();
        const out = await t!.execute({ text: '{"a":1}', pretty: true });
        expect(out).toContain('"a"');
        expect(out).toContain("1");
    });

    it("非法 JSON 返回错误说明", async () => {
        const t = getTool("json_validate");
        const out = await t!.execute({ text: "{not json" });
        expect(out).toMatch(/非法 JSON/);
    });
});
