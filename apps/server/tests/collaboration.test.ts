import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("V4 collaboration (plan + review)", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-collab-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        vi.resetModules();
    });

    it("create with template seeds v4_plan", async () => {
        const { createTask } = await import("@/tasks/taskService");
        const { getTaskPlanFromRecord } = await import("@/tasks/collaborationService");
        const t = await createTask({ templateId: "fix_bug" });
        expect(t.templateId).toBe("fix_bug");
        const p = getTaskPlanFromRecord(t);
        expect(p?.steps.length).toBeGreaterThan(0);
    });

    it("submitReviewVerdict pass: review -> approved", async () => {
        const { createTask, transitionTask } = await import("@/tasks/taskService");
        const { submitReviewVerdict } = await import("@/tasks/collaborationService");
        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await transitionTask(t0.taskId, { to: "review" });
        const t = await submitReviewVerdict(t0.taskId, {
            outcome: "pass",
            summary: "LGTM",
            findings: ["无阻塞"],
        });
        expect(t.status).toBe("approved");
    });

    it("submitReviewVerdict fail: review -> rejected", async () => {
        const { createTask, transitionTask } = await import("@/tasks/taskService");
        const { submitReviewVerdict } = await import("@/tasks/collaborationService");
        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await transitionTask(t0.taskId, { to: "review" });
        const t = await submitReviewVerdict(t0.taskId, {
            outcome: "fail",
            summary: "需改",
            findings: ["测试不足"],
            resumeFromStepIndex: 1,
        });
        expect(t.status).toBe("rejected");
    });

    it("prepareTaskForChatRound repairs running task when plan has no running step (done-only desync)", async () => {
        const { createTask, transitionTask, prepareTaskForChatRound } = await import("@/tasks/taskService");
        const { getTaskPlanFromRecord, getRunningPlanStepFromRecord } = await import(
            "@/tasks/collaborationService"
        );
        const { readTask, writeTask } = await import("@/tasks/taskStore");
        const { META_PLAN_KEY } = await import("@/tasks/collaborationTypes");

        const t0 = await createTask({ templateId: "fix_bug" });
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });

        const cur = await readTask(t0.taskId);
        expect(cur).toBeTruthy();
        const plan = getTaskPlanFromRecord(cur!);
        expect(plan?.steps.length).toBeGreaterThan(0);
        const broken = {
            ...plan!,
            steps: plan!.steps.map((s, i) => (i === 0 ? { ...s, status: "done" as const } : s)),
        };
        await writeTask({
            ...cur!,
            meta: { ...(cur!.meta ?? {}), [META_PLAN_KEY]: broken },
        });

        const mid = await readTask(t0.taskId);
        expect(getRunningPlanStepFromRecord(mid!)).toBeNull();

        const prep = await prepareTaskForChatRound(t0.taskId);
        expect(prep.record?.status).toBe("running");
        const running = getRunningPlanStepFromRecord(prep.record!);
        expect(running).not.toBeNull();
        expect(running?.status).toBe("running");
    });
});