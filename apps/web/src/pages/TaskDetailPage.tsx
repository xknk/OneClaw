import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
    apiGetTask,
    apiTaskApprove,
    apiTaskCancel,
    apiTaskNote,
    apiTaskPlan,
    apiTaskResume,
    apiTaskRetry,
    apiTaskReview,
    apiTaskRun,
    apiTaskTransition,
    downloadTaskExport,
} from "@/api/client";
import type { TaskRecord, TaskStatus } from "@/api/types";
import { Button, Card, Input, Select, TextArea, StatusBadge } from "@/components/ui";

const ALL_STATUS: TaskStatus[] = [
    "draft",
    "planned",
    "running",
    "pending_approval",
    "review",
    "approved",
    "rejected",
    "done",
    "failed",
    "cancelled",
];

export function TaskDetailPage() {
    const { taskId: rawId } = useParams();
    const taskId = rawId ? decodeURIComponent(rawId) : "";
    const [task, setTask] = useState<TaskRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    const [transTo, setTransTo] = useState<TaskStatus>("running");
    const [transReason, setTransReason] = useState("");
    const [noteText, setNoteText] = useState("");
    const [planJson, setPlanJson] = useState(
        '[{"index":0,"title":"步骤","intent":"chat"}]',
    );
    const [reviewOutcome, setReviewOutcome] = useState<"pass" | "fail">("pass");
    const [reviewSummary, setReviewSummary] = useState("");
    const [reviewFindings, setReviewFindings] = useState("");
    const [approveComment, setApproveComment] = useState("");
    const [resumeStep, setResumeStep] = useState("0");
    const [resumeLabel, setResumeLabel] = useState("");
    const [resumePayload, setResumePayload] = useState("{}");
    const [runTrace, setRunTrace] = useState("");

    const load = useCallback(async () => {
        if (!taskId) return;
        setError(null);
        setLoading(true);
        try {
            const t = await apiGetTask(taskId);
            setTask(t);
        } catch (e) {
            setError(e instanceof Error ? e.message : "加载失败");
            setTask(null);
        } finally {
            setLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        void load();
    }, [load]);

    const flash = (m: string) => {
        setMsg(m);
        setTimeout(() => setMsg(null), 3200);
    };

    const run = async (fn: () => Promise<void>) => {
        setError(null);
        try {
            await fn();
            flash("已保存");
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "操作失败");
        }
    };

    if (!taskId) {
        return <p className="text-slate-500">缺少 taskId</p>;
    }

    if (loading && !task) {
        return <p className="text-slate-500">加载中…</p>;
    }

    if (error && !task) {
        return (
            <div className="space-y-4">
                <p className="text-rose-400">{error}</p>
                <Link to="/tasks" className="text-claw-400 hover:underline">
                    返回列表
                </Link>
            </div>
        );
    }

    if (!task) {
        return null;
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to="/tasks" className="text-sm text-claw-400 hover:underline">
                    ← 任务列表
                </Link>
                {msg && <span className="text-xs text-claw-300">{msg}</span>}
            </div>

            <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-white">{task.title}</h2>
                        <p className="font-mono text-xs text-slate-500">{task.taskId}</p>
                    </div>
                    <StatusBadge status={task.status} />
                </div>
                {task.failureReason && (
                    <p className="mt-2 text-sm text-rose-300">失败原因：{task.failureReason}</p>
                )}
                {task.checkpoint && (
                    <p className="mt-2 text-xs text-slate-400">
                        检查点：step {task.checkpoint.stepIndex}
                        {task.checkpoint.label ? ` · ${task.checkpoint.label}` : ""}
                    </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                            void run(async () => {
                                await downloadTaskExport(task.taskId, "json");
                            })
                        }
                    >
                        导出 JSON
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                            void run(async () => {
                                await downloadTaskExport(task.taskId, "md");
                            })
                        }
                    >
                        导出 Markdown
                    </Button>
                </div>
            </Card>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">状态迁移</h3>
                <p className="text-xs text-slate-500">POST /api/tasks/:id/transition</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-400">
                        目标状态
                        <Select
                            className="mt-1"
                            value={transTo}
                            onChange={(e) => setTransTo(e.target.value as TaskStatus)}
                        >
                            {ALL_STATUS.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        原因（可选）
                        <TextArea
                            className="mt-1"
                            value={transReason}
                            onChange={(e) => setTransReason(e.target.value)}
                            rows={2}
                        />
                    </label>
                </div>
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() =>
                        void run(async () => {
                            const r = await apiTaskTransition(task.taskId, {
                                to: transTo,
                                reason: transReason.trim() || undefined,
                            });
                            setTask(r);
                        })
                    }
                >
                    提交迁移
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">快捷操作</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                            void run(async () => {
                                const r = await apiTaskCancel(task.taskId);
                                setTask(r);
                            })
                        }
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                            void run(async () => {
                                const r = await apiTaskRetry(task.taskId);
                                setTask(r);
                            })
                        }
                    >
                        重试
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                            void run(async () => {
                                const r = await apiTaskRun(task.taskId, runTrace.trim() || undefined);
                                setTask(r);
                            })
                        }
                    >
                        运行
                    </Button>
                </div>
                <label className="mt-3 block text-xs text-slate-400">
                    run 的 traceId（可选）
                    <Input
                        className="mt-1"
                        value={runTrace}
                        onChange={(e) => setRunTrace(e.target.value)}
                    />
                </label>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">从检查点恢复</h3>
                <p className="text-xs text-slate-500">POST /api/tasks/:id/resume</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-400">
                        stepIndex
                        <Input
                            className="mt-1"
                            type="number"
                            value={resumeStep}
                            onChange={(e) => setResumeStep(e.target.value)}
                        />
                    </label>
                    <label className="block text-xs text-slate-400">
                        label（可选）
                        <Input
                            className="mt-1"
                            value={resumeLabel}
                            onChange={(e) => setResumeLabel(e.target.value)}
                        />
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        payload JSON（可选）
                        <TextArea
                            className="mt-1 font-mono text-xs"
                            value={resumePayload}
                            onChange={(e) => setResumePayload(e.target.value)}
                            rows={3}
                        />
                    </label>
                </div>
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() =>
                        void run(async () => {
                            let payload: Record<string, unknown> | undefined;
                            try {
                                const p = JSON.parse(resumePayload || "{}") as unknown;
                                payload =
                                    p && typeof p === "object" && !Array.isArray(p)
                                        ? (p as Record<string, unknown>)
                                        : undefined;
                            } catch {
                                throw new Error("payload 不是合法 JSON 对象");
                            }
                            const r = await apiTaskResume(task.taskId, {
                                stepIndex: Number(resumeStep),
                                label: resumeLabel.trim() || undefined,
                                payload,
                            });
                            setTask(r);
                        })
                    }
                >
                    恢复
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">时间轴备注</h3>
                <p className="text-xs text-slate-500">POST /api/tasks/:id/note</p>
                <TextArea
                    className="mt-3"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="备注内容"
                    rows={3}
                />
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() =>
                        void run(async () => {
                            const r = await apiTaskNote(task.taskId, noteText.trim());
                            setTask(r);
                            setNoteText("");
                        })
                    }
                >
                    添加备注
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">Planner 计划</h3>
                <p className="text-xs text-slate-500">POST /api/tasks/:id/plan · steps 为 JSON 数组</p>
                <TextArea
                    className="mt-3 font-mono text-xs"
                    value={planJson}
                    onChange={(e) => setPlanJson(e.target.value)}
                    rows={6}
                />
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() =>
                        void run(async () => {
                            const steps = JSON.parse(planJson) as unknown;
                            const r = await apiTaskPlan(task.taskId, { steps });
                            setTask(r);
                        })
                    }
                >
                    提交计划
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">Review 结论</h3>
                <p className="text-xs text-slate-500">POST /api/tasks/:id/review</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-400">
                        outcome
                        <Select
                            className="mt-1"
                            value={reviewOutcome}
                            onChange={(e) => setReviewOutcome(e.target.value as "pass" | "fail")}
                        >
                            <option value="pass">pass</option>
                            <option value="fail">fail</option>
                        </Select>
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        summary
                        <TextArea
                            className="mt-1"
                            value={reviewSummary}
                            onChange={(e) => setReviewSummary(e.target.value)}
                            rows={2}
                        />
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        findings（JSON 或任意文本）
                        <TextArea
                            className="mt-1"
                            value={reviewFindings}
                            onChange={(e) => setReviewFindings(e.target.value)}
                            rows={3}
                        />
                    </label>
                </div>
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() =>
                        void run(async () => {
                            let findings: unknown = reviewFindings;
                            try {
                                findings = JSON.parse(reviewFindings);
                            } catch {
                                findings = reviewFindings;
                            }
                            const r = await apiTaskReview(task.taskId, {
                                outcome: reviewOutcome,
                                summary: reviewSummary,
                                findings,
                            });
                            setTask(r);
                        })
                    }
                >
                    提交评审
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">人工批准</h3>
                <p className="text-xs text-slate-500">POST /api/tasks/:id/approve</p>
                <Input
                    className="mt-3"
                    placeholder="comment（可选）"
                    value={approveComment}
                    onChange={(e) => setApproveComment(e.target.value)}
                />
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() =>
                        void run(async () => {
                            const r = await apiTaskApprove(
                                task.taskId,
                                approveComment.trim() || undefined,
                            );
                            setTask(r);
                        })
                    }
                >
                    批准
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-white">时间轴</h3>
                <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-xs text-slate-400">
                    {task.timeline
                        .slice()
                        .reverse()
                        .map((e, i) => (
                            <li
                                key={`${e.at}-${i}`}
                                className="rounded-lg border border-slate-800/80 bg-slate-900/40 p-2"
                            >
                                <span className="text-slate-500">[{e.kind}]</span> {e.at}
                                {e.kind === "note" && (
                                    <pre className="mt-1 whitespace-pre-wrap text-slate-300">{e.text}</pre>
                                )}
                                {e.kind === "transition" && (
                                    <p className="mt-1 text-slate-300">
                                        {e.from} → {e.to}
                                    </p>
                                )}
                                {e.kind === "step" && (
                                    <p className="mt-1 text-slate-300">
                                        step {e.stepIndex}
                                        {e.label ? ` · ${e.label}` : ""}
                                        {e.summary ? ` — ${e.summary}` : ""}
                                    </p>
                                )}
                            </li>
                        ))}
                </ul>
            </Card>
        </div>
    );
}
