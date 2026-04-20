import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    META_APPROVAL_GRANTS_KEY,
    type TaskApprovalGrants,
} from "@/tasks/collaborationTypes";

describe("task approval gate (M3)", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-appr-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        process.env.ONECLAW_TASK_HIGH_RISK_APPROVAL = "true";
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        delete process.env.ONECLAW_TASK_HIGH_RISK_APPROVAL;
        vi.resetModules();
    });

    it("blocks exec and moves task to pending_approval", async () => {
        const { createTask, transitionTask } = await import("@/tasks/taskService");
        const { interceptHighRiskToolForTask } = await import("@/tasks/taskApproval");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });

        const msg = await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "exec",
            args: { command: "npm run lint" },
            traceId: "t-1",
            riskLevel: "high",
        });
        expect(msg).toMatch(/待人工审批|pending_approval/);

        const { getTask } = await import("@/tasks/taskService");
        const t1 = await getTask(t0.taskId);
        expect(t1?.status).toBe("pending_approval");
    }, 15_000);

    it("approve returns to running", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const { interceptHighRiskToolForTask, approvePendingTask } = await import("@/tasks/taskApproval");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "apply_patch",
            args: { patch: "x" },
            traceId: "t-2",
            riskLevel: "low",
        });

        const t2 = await approvePendingTask(t0.taskId, "ok");
        expect(t2.status).toBe("running");
        const t3 = await getTask(t0.taskId);
        expect(t3?.meta?.v4_pending_approval).toBeUndefined();
    });

    it("blocks when riskLevel is high even if tool name is not exec/apply_patch", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const { interceptHighRiskToolForTask } = await import("@/tasks/taskApproval");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });

        const msg = await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "mcp_dangerous_write",
            args: { path: "/tmp/x" },
            traceId: "t-3",
            riskLevel: "high",
        });
        expect(msg).toMatch(/待人工审批|pending_approval/);

        const t1 = await getTask(t0.taskId);
        expect(t1?.status).toBe("pending_approval");
    });

    it("does not block unknown tool without high riskLevel", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const { interceptHighRiskToolForTask } = await import("@/tasks/taskApproval");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });

        const pass = await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "some_readonly_thing",
            args: {},
            traceId: "t-4",
            riskLevel: "low",
        });
        expect(pass).toBeNull();

        const t1 = await getTask(t0.taskId);
        expect(t1?.status).toBe("running");
    });

    it("after approve, same high-risk tool is not blocked again until terminal", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const { interceptHighRiskToolForTask, approvePendingTask } = await import("@/tasks/taskApproval");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });

        await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "exec",
            args: { command: "a" },
            traceId: "t-grant-1",
            riskLevel: "high",
        });
        await approvePendingTask(t0.taskId, "ok");

        const pass = await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "exec",
            args: { command: "b" },
            traceId: "t-grant-2",
            riskLevel: "high",
        });
        expect(pass).toBeNull();
        const t1 = await getTask(t0.taskId);
        expect(t1?.status).toBe("running");
        const grants = t1?.meta?.[META_APPROVAL_GRANTS_KEY] as TaskApprovalGrants | undefined;
        expect(Array.isArray(grants?.toolNames)).toBe(true);
        expect(grants?.toolNames).toContain("exec");
    });

    it("grants cleared when task fails", async () => {
        const { createTask, transitionTask, getTask, failTask } = await import("@/tasks/taskService");
        const { interceptHighRiskToolForTask, approvePendingTask } = await import("@/tasks/taskApproval");

        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned" });
        await transitionTask(t0.taskId, { to: "running" });
        await interceptHighRiskToolForTask({
            taskId: t0.taskId,
            toolName: "exec",
            args: {},
            traceId: "t-fail-1",
            riskLevel: "high",
        });
        await approvePendingTask(t0.taskId);

        await failTask(t0.taskId, "boom");
        const tDead = await getTask(t0.taskId);
        expect(tDead?.meta?.[META_APPROVAL_GRANTS_KEY]).toBeUndefined();
    }, 15_000);
});