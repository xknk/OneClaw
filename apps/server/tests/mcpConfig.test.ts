import { describe, it, expect } from "vitest";
import { parseMcpServerConfigs } from "@/config/mcpConfig";

describe("mcpConfig", () => {
    it("parseMcpServerConfigs 丢弃无效项并解析别名 server", () => {
        const cfg = parseMcpServerConfigs([
            { id: "a", command: "node" },
            { server: "b", command: "pnpm", args: ["x"], priority: 10 },
            {},
            { id: "", command: "x" },
        ]);
        expect(cfg).toHaveLength(2);
        expect(cfg[0]).toMatchObject({ id: "a", command: "node" });
        expect(cfg[1]).toMatchObject({ id: "b", command: "pnpm", args: ["x"], priority: 10 });
    });

    it("非法 JSON 类型的顶层返回空数组", () => {
        expect(parseMcpServerConfigs(null)).toEqual([]);
        expect(parseMcpServerConfigs({})).toEqual([]);
    });
});