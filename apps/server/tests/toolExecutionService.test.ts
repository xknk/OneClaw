import { describe, it, expect } from "vitest";
import { ToolExecutionService, createRegistryWithProviders } from "@/tools";
import type { ToolProvider } from "@/tools/types";

const baseCtx = {
    traceId: "t1",
    channelId: "webchat",
    sessionKey: "main",
    agentId: "main",
    profileId: "webchat_default",
};

describe("ToolExecutionService", () => {
    it("参数校验失败会返回可解释错误", async () => {
        const p: ToolProvider = {
            id: "p",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "echo",
                        schema: {
                            name: "echo",
                            description: "echo",
                            parameters: {
                                type: "object",
                                required: ["text"],
                                properties: { text: { type: "string" } },
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
                    content: "ok",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "echo",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([p]),
            ctx: baseCtx,
        });

        const r = await svc.execute("echo", {});
        expect(r).toContain("参数错误");
    });

    it("toolGuard 拒绝优先于执行", async () => {
        let executed = false;
        const p: ToolProvider = {
            id: "p",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "danger",
                        schema: { name: "danger", description: "d", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "high",
                    },
                ];
            },
            async execute() {
                executed = true;
                return {
                    ok: true,
                    content: "should not run",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "danger",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([p]),
            ctx: baseCtx,
            toolGuard: () => "无权限：测试拒绝",
        });

        const r = await svc.execute("danger", {});
        expect(r).toContain("无权限");
        expect(executed).toBe(false);
    });

    it("low risk 超时后默认重试 1 次", async () => {
        let count = 0;
        const p: ToolProvider = {
            id: "timeout-low",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "slow_low",
                        schema: { name: "slow_low", description: "slow", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "low",
                        timeoutMs: 20,
                    },
                ];
            },
            async execute() {
                count += 1;
                // 永不 resolve，避免与短超时竞态（慢机上 20ms 定时器可能晚于 100ms 完成）
                await new Promise<never>(() => {});
                return {
                    ok: true,
                    content: "too late",
                    durationMs: 100,
                    source: "builtin",
                    toolName: "slow_low",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([p]),
            ctx: baseCtx,
            defaultBackoffMs: 0,
        });

        const r = await svc.execute("slow_low", {});
        expect(r).toContain("超时");
        expect(count).toBe(2); // 首次 + 1 次重试
    });

    it("high risk 超时不重试", async () => {
        let count = 0;
        const p: ToolProvider = {
            id: "timeout-high",
            priority: 10,
            async listDefinitions() {
                return [
                    {
                        name: "slow_high",
                        schema: { name: "slow_high", description: "slow", parameters: { type: "object" } },
                        source: "builtin",
                        riskLevel: "high",
                        timeoutMs: 20,
                    },
                ];
            },
            async execute() {
                count += 1;
                await new Promise<never>(() => {});
                return {
                    ok: true,
                    content: "too late",
                    durationMs: 100,
                    source: "builtin",
                    toolName: "slow_high",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([p]),
            ctx: baseCtx,
            defaultBackoffMs: 0,
        });

        const r = await svc.execute("slow_high", {});
        expect(r).toContain("超时");
        expect(count).toBe(1);
    });

    it("超过单请求调用次数上限会被拒绝", async () => {
        const p: ToolProvider = {
            id: "limit",
            priority: 10,
            async listDefinitions() {
                return [{
                    name: "echo_limit",
                    schema: { name: "echo_limit", description: "x", parameters: { type: "object" } },
                    source: "builtin",
                    riskLevel: "low",
                    timeoutMs: 1000,
                    retryPolicy: { maxRetries: 0, backoffMs: 0 },
                }];
            },
            async execute() {
                return {
                    ok: true,
                    content: "ok",
                    durationMs: 1,
                    source: "builtin",
                    toolName: "echo_limit",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([p]),
            ctx: baseCtx,
            maxCallsPerToolPerRequest: 2,
        });

        expect(await svc.execute("echo_limit", {})).toBe("ok");
        expect(await svc.execute("echo_limit", {})).toBe("ok");

        const third = await svc.execute("echo_limit", {});
        expect(third).toContain("超过单请求最大调用次数 2");
    });

    it("高风险工具即使配置 retry 也应被执行层强制不重试（由 provider 定义决定）", async () => {
        let count = 0;
        const p: ToolProvider = {
            id: "high-no-retry",
            priority: 10,
            async listDefinitions() {
                return [{
                    name: "danger_tool",
                    schema: { name: "danger_tool", description: "d", parameters: { type: "object" } },
                    source: "skill",
                    riskLevel: "high",
                    timeoutMs: 20,
                    retryPolicy: { maxRetries: 3, backoffMs: 0 }, // 即使这么配，shouldRetry 也会挡住
                }];
            },
            async execute() {
                count += 1;
                await new Promise<never>(() => {});
                return {
                    ok: true,
                    content: "late",
                    durationMs: 100,
                    source: "skill",
                    toolName: "danger_tool",
                };
            },
        };

        const svc = new ToolExecutionService({
            registry: createRegistryWithProviders([p]),
            ctx: baseCtx,
            defaultBackoffMs: 0,
        });

        const out = await svc.execute("danger_tool", {});
        expect(out).toContain("超时");
        expect(count).toBe(1);
    });
});