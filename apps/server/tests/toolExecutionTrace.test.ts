import { describe, it, expect } from "vitest";
import { ToolExecutionService, createRegistryWithProviders } from "@/tools";
import type { ToolProvider } from "@/tools/types";

const ctx = {
    traceId: "trace-1",
    channelId: "webchat",
    sessionKey: "main",
    agentId: "main",
    profileId: "webchat_default",
};

describe("ToolExecutionService trace events", () => {
    it("emits resolve + execute.end on success", async () => {
        const provider: ToolProvider = {
            id: "p1",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "echo_ok",
                        schema: { name: "echo_ok", description: "echo", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "low",
                        timeoutMs: 1000,
                        retryPolicy: { maxRetries: 0, backoffMs: 0 },
                    },
                ];
            },
            async execute() {
                return {
                    ok: true,
                    content: "ok",
                    durationMs: 5,
                    source: "builtin",
                    toolName: "echo_ok",
                };
            },
        };

        const events: Array<{ eventType: string; patch?: Record<string, unknown> }> = [];

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([provider]),
            ctx,
            trace: async (eventType, patch) => {
                events.push({ eventType, patch });
            },
        });

        const out = await svc.execute("echo_ok", {});
        expect(out).toBe("ok");

        const names = events.map((e) => e.eventType);
        expect(names).toContain("tool.resolve");
        expect(names).toContain("tool.execute.end");
    });

    it("emits tool.denied with POLICY_UNKNOWN when guard returns string", async () => {
        const provider: ToolProvider = {
            id: "p2",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "blocked_tool",
                        schema: { name: "blocked_tool", description: "x", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "low",
                    },
                ];
            },
            async execute() {
                return {
                    ok: true,
                    content: "should not run",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "blocked_tool",
                };
            },
        };

        const events: Array<{ eventType: string; patch?: Record<string, unknown> }> = [];

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([provider]),
            ctx,
            toolGuard: () => "无权限：测试拒绝",
            trace: async (eventType, patch) => {
                events.push({ eventType, patch });
            },
        });

        const out = await svc.execute("blocked_tool", {});
        expect(out).toContain("无权限");

        const denied = events.find((e) => e.eventType === "tool.denied");
        expect(denied).toBeDefined();
        expect(denied?.patch?.errorCode).toBe("POLICY_UNKNOWN");
        expect(denied?.patch?.meta).toBeDefined();
    });

    it("emits tool.denied with structured errorCode and meta", async () => {
        const provider: ToolProvider = {
            id: "p2b",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "blocked2",
                        schema: { name: "blocked2", description: "x", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "low",
                    },
                ];
            },
            async execute() {
                return {
                    ok: true,
                    content: "should not run",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "blocked2",
                };
            },
        };

        const events: Array<{ eventType: string; patch?: Record<string, unknown> }> = [];

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([provider]),
            ctx,
            toolGuard: () => ({
                allow: false as const,
                message: "结构化拒绝",
                errorCode: "POLICY_UNIT_TEST",
                auditMeta: { reason: "fixture" },
            }),
            trace: async (eventType, patch) => {
                events.push({ eventType, patch });
            },
        });

        const out = await svc.execute("blocked2", { x: 1 });
        expect(out).toContain("结构化拒绝");

        const denied = events.find((e) => e.eventType === "tool.denied");
        expect(denied?.patch?.errorCode).toBe("POLICY_UNIT_TEST");
        const meta = denied?.patch?.meta as Record<string, unknown> | undefined;
        expect(meta?.reason).toBe("fixture");
        expect(meta?.toolName).toBe("blocked2");
    });

    it("emits tool.validation.failed when args invalid", async () => {
        const provider: ToolProvider = {
            id: "p3",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "need_text",
                        schema: {
                            name: "need_text",
                            description: "need text",
                            parameters: {
                                type: "object",
                                required: ["text"],
                                properties: {
                                    text: { type: "string" },
                                },
                            },
                        },
                        source: "builtin",
                        riskLevel: "low",
                    },
                ];
            },
            async execute() {
                return {
                    ok: true,
                    content: "should not run",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "need_text",
                };
            },
        };

        const events: string[] = [];

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([provider]),
            ctx,
            trace: async (eventType) => {
                events.push(eventType);
            },
        });

        const out = await svc.execute("need_text", {});
        expect(out).toContain("参数错误");
        expect(events).toContain("tool.validation.failed");
    });
});