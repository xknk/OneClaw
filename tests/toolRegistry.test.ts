import { describe, it, expect } from "vitest";
import { ToolRegistry } from "@/tools/registry";
import type { ToolProvider } from "@/tools/types";

const ctx = {
    traceId: "t1",
    channelId: "webchat",
    sessionKey: "main",
    agentId: "main",
    profileId: "webchat_default",
};

describe("ToolRegistry", () => {
    it("同名工具按 provider priority 覆盖", async () => {
        const low: ToolProvider = {
            id: "low",
            priority: 10,
            async listDefinitions() {
                return [{
                    name: "x",
                    schema: { name: "x", description: "low", parameters: { type: "object" } },
                    source: "builtin",
                    riskLevel: "low",
                }];
            },
            async execute() { return null; },
        };

        const high: ToolProvider = {
            id: "high",
            priority: 20,
            async listDefinitions() {
                return [{
                    name: "x",
                    schema: { name: "x", description: "high", parameters: { type: "object" } },
                    source: "skill",
                    riskLevel: "low",
                }];
            },
            async execute() { return null; },
        };

        const reg = new ToolRegistry();
        reg.register(low);
        reg.register(high);

        const resolved = await reg.resolveByName("x", ctx);
        expect(resolved?.provider.id).toBe("high");
        expect(resolved?.definition.schema.description).toBe("high");
    });
});