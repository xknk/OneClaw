import { describe, it, expect } from "vitest";
import { createMcpProvider } from "@/tools/providers/mcpProvider";

describe("mcpProvider", () => {
    it("listDefinitions 只暴露 allowlist 工具", async () => {
        const provider = createMcpProvider({
            server: "s1",
            allowedToolNames: ["a"],
            client: {
                async listTools() {
                    return [
                        { name: "a", description: "A", parameters: { type: "object" } },
                        { name: "b", description: "B", parameters: { type: "object" } },
                    ];
                },
                async callTool() {
                    return "ok";
                },
            },
        });

        const defs = await provider.listDefinitions({
            traceId: "t",
            channelId: "webchat",
            sessionKey: "main",
            agentId: "main",
            profileId: "webchat_default",
        });

        expect(defs.map((d) => d.name)).toEqual(["a"]);
    });
});