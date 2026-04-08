import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("task resume", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-task-resume-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        vi.resetModules();
    });

    it("resumeFromCheckpoint 在无计划任务上仅恢复为 running", async () => {
        const { createTask, transitionTask, resumeFromCheckpoint } = await import("@/tasks/taskService");

        const t0 = await createTask({ title: "resume-no-plan" });
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await transitionTask(t0.taskId, {
            to: "failed",
            reason: "boom",
            failureReason: "boom",
            checkpoint: { stepIndex: 0, label: "x" },
        });

        const t = await resumeFromCheckpoint(t0.taskId, { stepIndex: 0, label: "x" });
        expect(t.status).toBe("running");
    });
});
