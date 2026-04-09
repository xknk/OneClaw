import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PRD v4-remaining §5-4：至少 2 个模板任务「计划 → 执行阶段 → 评审判定」链路验收。
 * 不涉及真实 LLM/工具调用，用语义上等价的状态迁移 + submitReviewVerdict 固化行为。
 */
describe("V4 template task E2E (M2 acceptance)", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-tpl-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        vi.resetModules();
    });

    it("fix_bug: 模板注入 v4_plan -> running -> review -> Reviewer 通过 -> approved -> done", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const {
            getTaskPlanFromRecord,
            getLastReviewFromRecord,
            submitReviewVerdict,
        } = await import("@/tasks/collaborationService");
        const { getTaskTemplate } = await import("@/tasks/templates");

        const tpl = getTaskTemplate("fix_bug");
        expect(tpl?.planSkeleton?.length).toBeGreaterThan(0);

        const t0 = await createTask({ templateId: "fix_bug", title: "E2E fix_bug" });
        expect(t0.templateId).toBe("fix_bug");
        expect(t0.status).toBe("draft");

        const plan0 = getTaskPlanFromRecord(t0);
        expect(plan0?.steps.length).toBe(tpl!.planSkeleton!.length);
        expect(plan0?.plannerNote).toMatch(/fix_bug/);
        expect(plan0?.steps.every((s) => s.status === "pending")).toBe(true);

        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await transitionTask(t0.taskId, { to: "review" });

        const afterReview = await submitReviewVerdict(t0.taskId, {
            outcome: "pass",
            summary: "Acceptance：模板任务链路 OK",
            findings: ["计划来自模板", "评审通过"],
        });
        expect(afterReview.status).toBe("approved");

        const verdict = getLastReviewFromRecord(afterReview);
        expect(verdict?.outcome).toBe("pass");
        expect(verdict?.summary).toContain("Acceptance");

        await transitionTask(t0.taskId, { to: "done" });
        const final = await getTask(t0.taskId);
        expect(final?.status).toBe("done");
        expect(getTaskPlanFromRecord(final!)?.version).toBe(1);
        expect(getLastReviewFromRecord(final!)?.outcome).toBe("pass");
        expect(final?.transitions.some((x) => x.to === "review")).toBe(true);
        expect(final?.transitions.some((x) => x.to === "approved")).toBe(true);
    });

    it("code_review: 模板注入 v4_plan -> review -> Reviewer 不通过 -> rejected", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const {
            getTaskPlanFromRecord,
            getLastReviewFromRecord,
            submitReviewVerdict,
        } = await import("@/tasks/collaborationService");
        const { getTaskTemplate } = await import("@/tasks/templates");

        const tpl = getTaskTemplate("code_review");
        expect(tpl?.planSkeleton?.length).toBe(3);

        const t0 = await createTask({ templateId: "code_review" });
        const plan0 = getTaskPlanFromRecord(t0);
        expect(plan0?.steps.length).toBe(3);
        expect(plan0?.steps[0]?.title).toMatch(/范围|确认/);

        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await transitionTask(t0.taskId, { to: "review" });

        const tRej = await submitReviewVerdict(t0.taskId, {
            outcome: "fail",
            summary: "需补充 cases",
            findings: ["测试覆盖不足"],
            resumeFromStepIndex: 1,
        });
        expect(tRej.status).toBe("rejected");

        const v = getLastReviewFromRecord(tRej);
        expect(v?.outcome).toBe("fail");
        expect(v?.resumeFromStepIndex).toBe(1);

        const persisted = await getTask(t0.taskId);
        expect(persisted?.status).toBe("rejected");
        expect(getTaskPlanFromRecord(persisted!)?.plannerNote).toMatch(/code_review/);
    });
});
