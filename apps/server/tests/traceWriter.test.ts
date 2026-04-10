import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
vi.mock("node:fs/promises", () => ({
    default: {
        mkdir: vi.fn(),
        appendFile: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
        unlink: vi.fn(),
    },
}));

vi.mock("@/config/evn", () => ({
    appConfig: {
        userWorkspaceDir: "D:/tmp-oneclaw-workspace",
        traceFileMaxBytes: 100,
        traceRetentionDays: 30,
    },
}));

import fs from "node:fs/promises";
import { appendTraceEvent, resetTraceWriterCacheForTests } from "@/observability/traceWriter";

describe("appendTraceEvent", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetTraceWriterCacheForTests();
        vi.mocked(fs.readdir).mockResolvedValue(
            [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
        );
    });

    it("creates trace dir and appends one JSONL line", async () => {
        const event = {
            traceId: "trace-1",
            timestamp: "2026-03-25T10:00:00.000Z",
            eventType: "session.start" as const,
            sessionKey: "main",
            agentId: "main",
            channelId: "webchat",
            profileId: "webchat_default",
            meta: { hello: "world" },
        };

        await appendTraceEvent(event);

        expect(fs.mkdir).toHaveBeenCalledTimes(1);
        expect(fs.mkdir).toHaveBeenCalledWith(
            path.join("D:/tmp-oneclaw-workspace", "logs", "trace"),
            { recursive: true }
        );

        expect(fs.appendFile).toHaveBeenCalledTimes(1);

        const [filePath, line, encoding] = vi.mocked(fs.appendFile).mock.calls[0];
        expect(String(filePath)).toMatch(
            /D:[\\/]+tmp-oneclaw-workspace[\\/]+logs[\\/]+trace[\\/]+trace-\d{4}-\d{2}-\d{2}\.jsonl$/
        );
        expect(encoding).toBe("utf-8");

        expect(typeof line).toBe("string");
        expect((line as string).endsWith("\n")).toBe(true);

        const parsed = JSON.parse((line as string).trim());
        expect(parsed).toEqual(event);
    });

    it("rotates to -part2 when main file would exceed max bytes", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2099-01-01T12:00:00.000Z"));

        vi.mocked(fs.readdir).mockResolvedValue(
            ["trace-2099-01-01.jsonl"] as unknown as Awaited<ReturnType<typeof fs.readdir>>
        );
        vi.mocked(fs.stat).mockResolvedValue({ size: 95 } as Awaited<ReturnType<typeof fs.stat>>);

        const event = {
            traceId: "t-rot",
            timestamp: "2099-01-01T12:00:00.000Z",
            eventType: "session.start" as const,
            sessionKey: "main",
            agentId: "main",
            channelId: "webchat",
            profileId: "webchat_default",
        };

        await appendTraceEvent(event);

        vi.useRealTimers();

        const [filePath] = vi.mocked(fs.appendFile).mock.calls[0];
        expect(String(filePath)).toContain("trace-2099-01-01-part2.jsonl");
    });
});
