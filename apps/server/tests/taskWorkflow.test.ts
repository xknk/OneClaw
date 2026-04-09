import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("V4 task workflow (M1)", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-task-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        vi.resetModules();
    });

    it("create -> planned -> running -> review -> approved -> done", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");

        const t0 = await createTask({ title: "demo" });
        expect(t0.status).toBe("draft");

        let t = await transitionTask(t0.taskId, { to: "planned" });
        expect(t.status).toBe("planned");

        t = await transitionTask(t.taskId, { to: "running" });
        expect(t.status).toBe("running");

        t = await transitionTask(t.taskId, { to: "review" });
        expect(t.status).toBe("review");

        t = await transitionTask(t.taskId, { to: "approved" });
        expect(t.status).toBe("approved");

        t = await transitionTask(t.taskId, { to: "done" });
        expect(t.status).toBe("done");

        const persisted = await getTask(t0.taskId);
        expect(persisted?.status).toBe("done");
        expect(persisted?.transitions.length).toBeGreaterThanOrEqual(5);
    });

    it("reject illegal transition", async () => {
        const { createTask, transitionTask } = await import("@/tasks/taskService");
        const t0 = await createTask({});
        await expect(transitionTask(t0.taskId, { to: "done" })).rejects.toThrow(/不允许/);
    });

    it("failed -> retry -> running", async () => {
        const { createTask, transitionTask, retryTask, getTask } = await import("@/tasks/taskService");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await transitionTask(t0.taskId, {
            to: "failed",
            failureReason: "boom",
            reason: "boom",
        });

        const t = await retryTask(t0.taskId, "manual_retry");
        expect(t.status).toBe("running");
        expect(t.failureReason).toBeUndefined();

        const persisted = await getTask(t0.taskId);
        expect(persisted?.status).toBe("running");
    });
});