import type express from "express";
import { redactForLog } from "@/util/redact";
import {
    appendTimelineNote,
    cancelTask,
    createTask,
    deleteTaskPermanently,
    getTask,
    listTasks,
    parseTaskStatus,
    resumeFromCheckpoint,
    retryTask,
    transitionTask,
    updateTaskTitle,
} from "@/tasks/taskService";
import type { TransitionTaskInput } from "@/tasks/types";
import {
    setTaskPlan,
    submitReviewVerdict,
} from "@/tasks/collaborationService";
import { approvePendingTask } from "@/tasks/taskApproval";
import { listTaskTemplateSummaries } from "@/tasks/templates";
import { buildTaskReportJson, parseExportFormat, renderTaskReportMarkdown } from "@/tasks/taskReport";
import { TaskValidationError } from "@/tasks/templateValidation";
import { runTask } from "@/tasks/taskRunner";
export function registerTaskRoutes(app: express.Application): void {
    /**
     * 创建任务接口
     */
    app.post("/api/tasks", async (req, res) => {
        try {
            const body = req.body ?? {};
            const rec = await createTask({
                title: typeof body.title === "string" ? body.title : undefined,
                templateId: typeof body.templateId === "string" ? body.templateId : undefined,
                params:
                    body.params && typeof body.params === "object" && body.params !== null
                        ? (body.params as Record<string, unknown>)
                        : undefined,
                meta:
                    body.meta && typeof body.meta === "object" && body.meta !== null
                        ? (body.meta as Record<string, unknown>)
                        : undefined,
            });
            res.status(201).json(rec);
        } catch (err) {
            if (err instanceof TaskValidationError) {
                res.status(400).json({ error: err.message });
                return;
            }
            console.error("/api/tasks POST:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
        }
    });
    /**
     * 获取任务列表接口
     */
    app.get("/api/tasks", async (req, res) => {
        try {
            const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
            const status = parseTaskStatus(String(req.query.status ?? ""));
            const failedOnly =
                String(req.query.failedOnly ?? req.query.failed_only ?? "") === "1" ||
                String(req.query.failedOnly ?? req.query.failed_only ?? "").toLowerCase() === "true";
            const rows = await listTasks({
                limit: Number.isFinite(limit) ? limit : undefined,
                status,
                failedOnly,
            });
            res.json({ tasks: rows });
        } catch (err) {
            console.error("/api/tasks GET:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
        }
    });
    /**
     * 获取任务接口
     */
    app.get("/api/tasks/:taskId", async (req, res) => {
        try {
            const rec = await getTask(req.params.taskId);
            if (!rec) {
                res.status(404).json({ error: "任务不存在" });
                return;
            }
            res.json(rec);
        } catch (err) {
            console.error("/api/tasks/:taskId GET:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
        }
    });
    /**
     * 更新任务标题（允许在 UI 中修改）
     */
    app.patch("/api/tasks/:taskId", async (req, res) => {
        try {
            const body = req.body ?? {};
            const title = typeof body.title === "string" ? body.title : "";
            if (!title.trim()) {
                res.status(400).json({ error: "body.title 必填" });
                return;
            }
            const rec = await updateTaskTitle(req.params.taskId, title);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : msg.includes("不能为空") || msg.includes("必填") ? 400 : 500;
            if (code === 500) console.error("/api/tasks PATCH:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /**
     * 永久删除任务记录（管理端 / 清理）
     */
    app.delete("/api/tasks/:taskId", async (req, res) => {
        try {
            await deleteTaskPermanently(req.params.taskId);
            res.status(204).send();
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : 500;
            if (code === 500) console.error("/api/tasks DELETE:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /**
     * 状态迁移接口
     */
    app.post("/api/tasks/:taskId/transition", async (req, res) => {
        try {
            const body = req.body ?? {};
            const to = parseTaskStatus(typeof body.to === "string" ? body.to : "");
            if (!to) {
                res.status(400).json({ error: "body.to 必须为合法 TaskStatus" });
                return;
            }
            const input: TransitionTaskInput = {
                to,
                reason: typeof body.reason === "string" ? body.reason : undefined,
                meta:
                    body.meta && typeof body.meta === "object"
                        ? (body.meta as Record<string, unknown>)
                        : undefined,
                checkpoint:
                    body.checkpoint && typeof body.checkpoint === "object"
                        ? {
                            stepIndex: Number((body.checkpoint as { stepIndex?: unknown }).stepIndex),
                            label:
                                typeof (body.checkpoint as { label?: unknown }).label === "string"
                                    ? (body.checkpoint as { label: string }).label
                                    : undefined,
                            payload:
                                (body.checkpoint as { payload?: unknown }).payload &&
                                    typeof (body.checkpoint as { payload?: unknown }).payload ===
                                    "object"
                                    ? (body.checkpoint as { payload: Record<string, unknown> })
                                        .payload
                                    : undefined,
                        }
                        : undefined,
                timelineNote:
                    typeof body.timelineNote === "string" ? body.timelineNote : undefined,
                failureReason:
                    typeof body.failureReason === "string" ? body.failureReason : undefined,
            };
            if (input.checkpoint && !Number.isFinite(input.checkpoint.stepIndex)) {
                res.status(400).json({ error: "checkpoint.stepIndex 无效" });
                return;
            }
            const rec = await transitionTask(req.params.taskId, input);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code =
                msg.includes("不存在")
                    ? 404
                    : msg.includes("不允许") || msg.includes("终态") || msg.includes("不可迁移")
                      ? 400
                      : 500;
            if (code === 500) console.error("/api/tasks transition:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /**
     * 取消任务接口
     */
    app.post("/api/tasks/:taskId/cancel", async (req, res) => {
        try {
            const body = req.body ?? {};
            const reason = typeof body.reason === "string" ? body.reason : undefined;
            const rec = await cancelTask(req.params.taskId, reason);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : msg.includes("不允许") ? 400 : 500;
            if (code === 500) console.error("/api/tasks cancel:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /**
     * 重试任务接口
     */
    app.post("/api/tasks/:taskId/retry", async (req, res) => {
        try {
            const body = req.body ?? {};
            const reason = typeof body.reason === "string" ? body.reason : undefined;
            const rec = await retryTask(req.params.taskId, reason);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : msg.includes("仅失败") ? 400 : 500;
            if (code === 500) console.error("/api/tasks retry:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /**
     * 从检查点恢复任务接口
     */
    app.post("/api/tasks/:taskId/resume", async (req, res) => {
        try {
            const body = req.body ?? {};
            const cp = body.checkpoint;
            if (!cp || typeof cp !== "object") {
                res.status(400).json({ error: "body.checkpoint 必填" });
                return;
            }
            const stepIndex = Number((cp as { stepIndex?: unknown }).stepIndex);
            if (!Number.isFinite(stepIndex)) {
                res.status(400).json({ error: "checkpoint.stepIndex 无效" });
                return;
            }
            const rec = await resumeFromCheckpoint(req.params.taskId, {
                stepIndex,
                label:
                    typeof (cp as { label?: unknown }).label === "string"
                        ? (cp as { label: string }).label
                        : undefined,
                payload:
                    (cp as { payload?: unknown }).payload &&
                        typeof (cp as { payload?: unknown }).payload === "object"
                        ? (cp as { payload: Record<string, unknown> }).payload
                        : undefined,
            });
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : msg.includes("仅失败") ? 400 : 500;
            if (code === 500) console.error("/api/tasks resume:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /**
     * 添加时间轴备注接口
     */
    app.post("/api/tasks/:taskId/note", async (req, res) => {
        try {
            const body = req.body ?? {};
            const text = typeof body.text === "string" ? body.text : "";
            if (!text.trim()) {
                res.status(400).json({ error: "body.text 必填" });
                return;
            }
            const meta =
                body.meta && typeof body.meta === "object"
                    ? (body.meta as Record<string, unknown>)
                    : undefined;
            const rec = await appendTimelineNote(req.params.taskId, text, meta);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : 500;
            if (code === 500) console.error("/api/tasks note:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });

    /** M2：列出内置任务模板 */
    app.get("/api/task-templates", (_req, res) => {
        try {
            res.json({ templates: listTaskTemplateSummaries() });
        } catch (err) {
            console.error("/api/task-templates:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
        }
    });
    /** M2：Planner 提交/覆盖计划 */
    app.post("/api/tasks/:taskId/plan", async (req, res) => {
        try {
            const body = req.body ?? {};
            const rec = await setTaskPlan(req.params.taskId, {
                steps: body.steps,
                plannerNote: typeof body.plannerNote === "string" ? body.plannerNote : undefined,
            });
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : msg.includes("steps") ? 400 : 500;
            if (code === 500) console.error("/api/tasks plan:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
    /** M2：Reviewer 提交结论（仅 review 态） */
    app.post("/api/tasks/:taskId/review", async (req, res) => {
        try {
            const body = req.body ?? {};
            const outcome = body.outcome === "pass" || body.outcome === "fail" ? body.outcome : null;
            if (!outcome) {
                res.status(400).json({ error: "body.outcome 须为 pass 或 fail" });
                return;
            }
            const rec = await submitReviewVerdict(req.params.taskId, {
                outcome,
                summary: typeof body.summary === "string" ? body.summary : "",
                findings: body.findings,
                resumeFromStepIndex:
                    body.resumeFromStepIndex != null ? Number(body.resumeFromStepIndex) : undefined,
            });
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code =
                msg.includes("不存在") ? 404 : msg.includes("仅当") || msg.includes("必填") ? 400 : 500;
            if (code === 500) console.error("/api/tasks review:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });

    /** M3：人工批准高风险工具，任务从 pending_approval → running */
    app.post("/api/tasks/:taskId/approve", async (req, res) => {
        try {
            const body = req.body ?? {};
            const comment = typeof body.comment === "string" ? body.comment : undefined;
            const rec = await approvePendingTask(req.params.taskId, comment);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code =
                msg.includes("不存在") ? 404 : msg.includes("仅 pending") ? 400 : 500;
            if (code === 500) console.error("/api/tasks approve:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });

    /** M4：导出任务报告（JSON 或 Markdown） */
    app.get("/api/tasks/:taskId/export", async (req, res) => {
        try {
            const rec = await getTask(req.params.taskId);
            if (!rec) {
                res.status(404).json({ error: "任务不存在" });
                return;
            }
            const fmt = parseExportFormat(
                typeof req.query.format === "string" ? req.query.format : undefined
            );
            if (!fmt) {
                res.status(400).json({ error: "query.format 须为 json、md 或 markdown" });
                return;
            }
            if (fmt === "json") {
                res.type("application/json; charset=utf-8");
                res.send(buildTaskReportJson(rec));
                return;
            }
            res.type("text/markdown; charset=utf-8");
            res.send(renderTaskReportMarkdown(rec));
        } catch (err) {
            console.error("/api/tasks export:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
        }
    });
    app.post("/api/tasks/:taskId/run", async (req, res) => {
        try {
            const body = req.body ?? {};
            const traceId = typeof body.traceId === "string" ? body.traceId : undefined;
            const rec = await runTask(req.params.taskId, traceId);
            res.json(rec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("不存在") ? 404 : msg.includes("v4_plan") ? 400 : 500;
            if (code === 500) console.error("/api/tasks run:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });
}