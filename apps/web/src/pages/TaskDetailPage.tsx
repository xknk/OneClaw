import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatDateTime } from "@/lib/formatDateTime";
import { useLocale } from "@/locale/LocaleContext";
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
    const { locale, t } = useLocale();
    const { taskId: rawId } = useParams();
    const taskId = rawId ? decodeURIComponent(rawId) : "";
    const defaultPlanJson = useMemo(
        () =>
            locale === "en"
                ? '[{"index":0,"title":"Step","intent":"chat"}]'
                : '[{"index":0,"title":"步骤","intent":"chat"}]',
        [locale],
    );
    const [task, setTask] = useState<TaskRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    const [transTo, setTransTo] = useState<TaskStatus>("running");
    const [transReason, setTransReason] = useState("");
    const [noteText, setNoteText] = useState("");
    const [planJson, setPlanJson] = useState(defaultPlanJson);
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
            const rec = await apiGetTask(taskId);
            setTask(rec);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("task.loadFail"));
            setTask(null);
        } finally {
            setLoading(false);
        }
    }, [taskId, t]);

    useEffect(() => {
        void load();
    }, [load]);

    /** 切换任务时清空 Planner 文本框，避免沿用上一任务的计划内容 */
    useEffect(() => {
        setPlanJson(defaultPlanJson);
    }, [taskId, defaultPlanJson]);

    /** 从服务端任务单据同步 Planner 文本框（仅当有已保存计划时覆盖；须与路由 taskId 一致以防切换任务时串数据） */
    useEffect(() => {
        if (!task || task.taskId !== taskId) {
            return;
        }
        const raw = task.meta?.v4_plan;
        if (raw && typeof raw === "object" && raw !== null && "steps" in raw) {
            const steps = (raw as { steps?: unknown }).steps;
            if (Array.isArray(steps) && steps.length > 0) {
                setPlanJson(JSON.stringify(steps, null, 2));
            }
        }
    }, [task, taskId]);

    const flash = (m: string) => {
        setMsg(m);
        setTimeout(() => setMsg(null), 3200);
    };

    const run = async (fn: () => Promise<void>) => {
        setError(null);
        try {
            await fn();
            flash(t("task.saved"));
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("task.opFail"));
        }
    };

    if (!taskId) {
        return <p className="text-slate-500">{t("task.missingId")}</p>;
    }

    if (loading && !task) {
        return <p className="text-slate-500">{t("task.loading")}</p>;
    }

    if (error && !task) {
        return (
            <div className="space-y-4">
                <p className="text-rose-400">{error}</p>
                <Link to="/tasks" className="text-claw-400 hover:underline">
                    {t("task.backList")}
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
                    {t("task.listLink")}
                </Link>
                {msg && <span className="text-xs text-claw-300">{msg}</span>}
            </div>

            <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{task.title}</h2>
                        <p className="font-mono text-xs text-slate-500">{task.taskId}</p>
                        <p className="mt-1 text-xs text-slate-500">
                            {t("task.created")} {formatDateTime(task.createdAt, locale)} · {t("task.updated")}{" "}
                            {formatDateTime(task.updatedAt, locale)}
                        </p>
                    </div>
                    <StatusBadge status={task.status} label={t(`taskStatus.${task.status}`)} />
                </div>
                {task.failureReason && (
                    <p className="mt-2 text-sm text-rose-300">
                        {t("task.failure")}
                        {task.failureReason}
                    </p>
                )}
                {task.checkpoint && (
                    <p className="mt-2 text-xs text-slate-400">
                        {t("task.checkpoint")}
                        {task.checkpoint.stepIndex}
                        {task.checkpoint.label ? ` · ${task.checkpoint.label}` : ""}
                        {task.checkpoint.at ? ` · ${formatDateTime(task.checkpoint.at, locale)}` : ""}
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
                        {t("task.exportJson")}
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
                        {t("task.exportMd")}
                    </Button>
                </div>
            </Card>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.transition")}</h3>
                <p className="text-xs text-slate-500">{t("task.transitionHint")}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-400">
                        {t("task.targetStatus")}
                        <Select
                            className="mt-1"
                            value={transTo}
                            onChange={(e) => setTransTo(e.target.value as TaskStatus)}
                        >
                            {ALL_STATUS.map((s) => (
                                <option key={s} value={s}>
                                    {t(`taskStatus.${s}`)}
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        {t("task.reasonOpt")}
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
                    {t("task.submitTrans")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.quick")}</h3>
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
                        {t("task.cancel")}
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
                        {t("task.retry")}
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
                        {t("task.run")}
                    </Button>
                </div>
                <label className="mt-3 block text-xs text-slate-400">
                    {t("task.runTrace")}
                    <Input
                        className="mt-1"
                        value={runTrace}
                        onChange={(e) => setRunTrace(e.target.value)}
                    />
                </label>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.resume")}</h3>
                <p className="text-xs text-slate-500">{t("task.resumeHint")}</p>
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
                        {t("task.labelOpt")}
                        <Input
                            className="mt-1"
                            value={resumeLabel}
                            onChange={(e) => setResumeLabel(e.target.value)}
                        />
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        {t("task.payloadOpt")}
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
                                throw new Error(t("task.errPayloadJson"));
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
                    {t("task.resumeBtn")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.noteTitle")}</h3>
                <p className="text-xs text-slate-500">{t("task.noteHint")}</p>
                <TextArea
                    className="mt-3"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder={t("task.notePh")}
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
                    {t("task.addNote")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.planner")}</h3>
                <p className="text-xs text-slate-500">{t("task.plannerHint")}</p>
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
                    {t("task.submitPlan")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.review")}</h3>
                <p className="text-xs text-slate-500">{t("task.reviewHint")}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{t("task.reviewExplain")}</p>
                {task.status !== "review" && (
                    <p className="mt-2 rounded-lg border border-amber-900/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-100/90">
                        {t("task.reviewBlocked", { status: t(`taskStatus.${task.status}`) })}
                    </p>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-400">
                        outcome
                        <Select
                            className="mt-1"
                            value={reviewOutcome}
                            onChange={(e) => setReviewOutcome(e.target.value as "pass" | "fail")}
                        >
                            <option value="pass">{t("task.reviewOutcomePass")}</option>
                            <option value="fail">{t("task.reviewOutcomeFail")}</option>
                        </Select>
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        {t("task.summaryReq")}
                        <TextArea
                            className="mt-1"
                            value={reviewSummary}
                            onChange={(e) => setReviewSummary(e.target.value)}
                            placeholder={t("task.summaryPh")}
                            rows={2}
                        />
                    </label>
                    <label className="block text-xs text-slate-400 sm:col-span-2">
                        {t("task.findings")}
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
                    disabled={task.status !== "review"}
                    onClick={() =>
                        void run(async () => {
                            const summary = reviewSummary.trim();
                            if (!summary) {
                                throw new Error(t("task.errSummary"));
                            }
                            let findings: unknown = reviewFindings;
                            try {
                                findings = JSON.parse(reviewFindings);
                            } catch {
                                findings = reviewFindings;
                            }
                            const r = await apiTaskReview(task.taskId, {
                                outcome: reviewOutcome,
                                summary,
                                findings,
                            });
                            setTask(r);
                        })
                    }
                >
                    {t("task.submitReview")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.approve")}</h3>
                <p className="text-xs text-slate-500">{t("task.approveHint")}</p>
                <Input
                    className="mt-3"
                    placeholder={t("task.approvePh")}
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
                    {t("task.approveBtn")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("task.timeline")}</h3>
                <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-xs text-slate-400">
                    {task.timeline
                        .slice()
                        .reverse()
                        .map((e, i) => (
                            <li
                                key={`${e.at}-${i}`}
                                className="rounded-lg border border-slate-200/90 bg-slate-50 p-2 dark:border-slate-800/80 dark:bg-slate-900/40"
                            >
                                <span className="text-slate-500">[{e.kind}]</span>{" "}
                                <time
                                    className="text-slate-400"
                                    dateTime={e.at}
                                    title={e.at}
                                >
                                    {formatDateTime(e.at, locale)}
                                </time>
                                {e.kind === "note" && (
                                    <pre className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{e.text}</pre>
                                )}
                                {e.kind === "transition" && (
                                    <p className="mt-1 text-slate-700 dark:text-slate-300">
                                        {t(`taskStatus.${e.from}`)} → {t(`taskStatus.${e.to}`)}
                                    </p>
                                )}
                                {e.kind === "step" && (
                                    <p className="mt-1 text-slate-700 dark:text-slate-300">
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
