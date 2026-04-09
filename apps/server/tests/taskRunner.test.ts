import { describe, expect, it } from "vitest";
import { createTask, getTask, transitionTask } from "@/tasks/taskService";
import { setTaskPlan } from "@/tasks/collaborationService";
import { runTaskPlan } from "@/tasks/taskRunner";

describe("taskRunner", () => {
    it("多步顺序推进到 done", async () => {
        const task = await createTask({ title: "runner-seq" });
        await setTaskPlan(task.taskId, {
            steps: [
                { index: 0, title: "s0", intent: "i0", allowedTools: ["read_file"], status: "pending" },
                { index: 1, title: "s1", intent: "i1", allowedTools: ["read_file"], status: "pending" },
            ],
        });
        await transitionTask(task.taskId, { to: "planned" });
        await transitionTask(task.taskId, { to: "running" });

        const done = await runTaskPlan(task.taskId, {
            executeStep: async () => {
                // no-op
            },
        });

        expect(done.status).toBe("done");
        const latest = await getTask(task.taskId);
        expect(latest?.status).toBe("done");
    });

    it("步骤失败时写 checkpoint 且任务 failed", async () => {
        const task = await createTask({ title: "runner-fail" });
        await setTaskPlan(task.taskId, {
            steps: [{ index: 0, title: "s0", intent: "i0", allowedTools: ["read_file"], status: "pending" }],
        });
        await transitionTask(task.taskId, { to: "planned" });
        await transitionTask(task.taskId, { to: "running" });

        const failed = await runTaskPlan(task.taskId, {
            executeStep: async () => {
                throw new Error("boom");
            },
        });

        expect(failed.status).toBe("failed");
        expect(failed.checkpoint?.stepIndex).toBe(0);
        expect(failed.failureReason).toContain("boom");
    });

    it("同一时刻仅一个 running（非法计划应拒绝）", async () => {
        const task = await createTask({ title: "runner-invalid" });
        await setTaskPlan(task.taskId, {
            steps: [
                { index: 0, title: "a", intent: "a", allowedTools: ["read_file"], status: "running" },
                { index: 1, title: "b", intent: "b", allowedTools: ["read_file"], status: "running" },
            ],
        });
        await transitionTask(task.taskId, { to: "planned" });
        await transitionTask(task.taskId, { to: "running" });

        await expect(runTaskPlan(task.taskId)).rejects.toThrow("多个 running");
    });
});