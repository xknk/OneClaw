import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("task report export (M4)", () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = path.join(tmpdir(), `oneclaw-report-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(dataDir, { recursive: true });
        process.env.ONECLAW_DATA_DIR = dataDir;
        vi.resetModules();
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        delete process.env.ONECLAW_DATA_DIR;
        vi.resetModules();
    });

    it("JSON 含 task 与 exportedAt", async () => {
        const { createTask } = await import("@/tasks/taskService");
        const { buildTaskReportJson } = await import("@/tasks/taskReport");
        const t = await createTask({ title: "导出测试" });
        const raw = buildTaskReportJson(t);
        const obj = JSON.parse(raw) as { exportedAt: string; task: { taskId: string } };
        expect(obj.task.taskId).toBe(t.taskId);
        expect(typeof obj.exportedAt).toBe("string");
    });

    it("Markdown 含 taskId 与标题", async () => {
        const { createTask } = await import("@/tasks/taskService");
        const { renderTaskReportMarkdown } = await import("@/tasks/taskReport");
        const t = await createTask({ title: "MD 测试" });
        const md = renderTaskReportMarkdown(t);
        expect(md).toContain(t.taskId);
        expect(md).toContain("MD 测试");
        expect(md).toContain("# OneClaw 任务执行报告");
    });

    it("模板任务 Markdown 含结构化计划节", async () => {
        const { createTask } = await import("@/tasks/taskService");
        const { renderTaskReportMarkdown } = await import("@/tasks/taskReport");
        const t = await createTask({ templateId: "fix_bug", title: "bug" });
        const md = renderTaskReportMarkdown(t);
        expect(md).toContain("v4_plan");
        expect(md).toContain("结构化计划");
    });

    it("状态迁移后 Markdown 含 transitions", async () => {
        const { createTask, transitionTask, getTask } = await import("@/tasks/taskService");
        const { renderTaskReportMarkdown } = await import("@/tasks/taskReport");
        const t0 = await createTask({});
        await transitionTask(t0.taskId, { to: "planned", reason: "t" });
        const latest = await getTask(t0.taskId);
        expect(latest).not.toBeNull();
        const ma = renderTaskReportMarkdown(latest!);
        expect(ma).toContain("draft → planned");
    });
});

describe("parseExportFormat", () => {
    it("解析 json / md / markdown", async () => {
        const { parseExportFormat } = await import("@/tasks/taskReport");
        expect(parseExportFormat("json")).toBe("json");
        expect(parseExportFormat("md")).toBe("md");
        expect(parseExportFormat("markdown")).toBe("md");
        expect(parseExportFormat("bad")).toBeNull();
    });
});