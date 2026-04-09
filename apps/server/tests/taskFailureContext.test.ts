import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    META_LAST_FAILURE_CONTEXT_KEY,
    type TaskLastFailureContext,
} from "@/tasks/collaborationTypes";

describe("task failure context (trace + last tool step)", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-failctx-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        vi.resetModules();
    });

    it("failTask writes v4_last_failure_context with traceId and last tool step", async () => {
        const { createTask, transitionTask, failTask, getTask } = await import("@/tasks/taskService");
        const { appendTimelineToolStep } = await import("@/tasks/taskService");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });

        await appendTimelineToolStep(t0.taskId, {
            traceId: "trace-aaa",
            toolName: "exec",
            ok: true,
            durationMs: 10,
            summary: "ok",
        });

        await failTask(t0.taskId, "boom", {
            traceId: "trace-zzz",
            meta: { source: "test" },
        });

        const t = await getTask(t0.taskId);
        expect(t?.status).toBe("failed");
        const ctx = t?.meta?.[META_LAST_FAILURE_CONTEXT_KEY] as TaskLastFailureContext | undefined;
        expect(ctx?.traceId).toBe("trace-zzz");
        expect(ctx?.lastToolStepIndex).toBe(1);
        expect(ctx?.source).toBe("test");
    });

    it("retry from failed to running clears v4_last_failure_context", async () => {
        const { createTask, transitionTask, failTask, retryTask, getTask } = await import("@/tasks/taskService");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await failTask(t0.taskId, "x", { traceId: "t1" });

        await retryTask(t0.taskId);
        const t = await getTask(t0.taskId);
        expect(t?.status).toBe("running");
        expect(t?.meta?.[META_LAST_FAILURE_CONTEXT_KEY]).toBeUndefined();
    });
});