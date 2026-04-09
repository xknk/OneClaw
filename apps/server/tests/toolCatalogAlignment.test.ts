import { describe, it, expect } from "vitest";
import { createRegistryWithProviders, ToolExecutionService } from "@/tools";
import type { ToolProvider } from "@/tools/types";

const ctx = {
    traceId: "t",
    channelId: "webchat",
    sessionKey: "main",
    agentId: "main",
    profileId: "webchat_default",
};

describe("tool schema / execution alignment", () => {
    it("catalog 中出现的工具应可被 provider execute 命中", async () => {
        const provider: ToolProvider = {
            id: "mock",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "x",
                        schema: { name: "x", description: "x", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "low",
                    },
                ];
            },
            async execute(name) {
                if (name !== "x") return null;
                return {
                    ok: true,
                    content: "ok",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "x",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([provider]),
            ctx,
        });

        const schemas = await svc.getToolSchemas();
        expect(schemas.map((s) => s.name)).toContain("x");

        const out = await svc.execute("x", {});
        expect(out).toBe("ok");
    });
});