import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/locale/LocaleContext";
import { apiCreateTask, apiDeleteTask, apiListTasks, apiTaskTemplates } from "@/api/client";
import type { TaskRecord, TaskStatus, TaskTemplateSummary } from "@/api/types";
import { formatDateTime } from "@/lib/formatDateTime";
import { Button, Card, Input, Select, StatusBadge } from "@/components/ui";

const LIMIT_PRESETS = [25, 50, 100, 200, 500] as const;

const STATUSES: (TaskStatus | "")[] = [
    "",
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

export function TasksPage() {
    const { hasToken } = useAuth();
    const { locale, t } = useLocale();
    const [tasks, setTasks] = useState<TaskRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<TaskStatus | "">("");
    const [failedOnly, setFailedOnly] = useState(false);
    const [limit, setLimit] = useState(50);
    const [title, setTitle] = useState("");
    const [templateId, setTemplateId] = useState("");
    const [templates, setTemplates] = useState<TaskTemplateSummary[]>([]);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!hasToken) {
            setTemplates([]);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const { templates: rows } = await apiTaskTemplates();
                if (!cancelled) setTemplates(rows);
            } catch {
                if (!cancelled) setTemplates([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [hasToken]);

    const load = useCallback(async () => {
        setError(null);
        setLoading(true);
        try {
            const { tasks: rows } = await apiListTasks({
                limit,
                status: status || undefined,
                failedOnly,
            });
            setTasks(rows);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("tasks.loadFail"));
        } finally {
            setLoading(false);
        }
    }, [failedOnly, limit, status, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const create = async () => {
        if (!hasToken) {
            return;
        }
        setCreating(true);
        setError(null);
        try {
            await apiCreateTask({
                title: title.trim() || undefined,
                templateId: templateId.trim() || undefined,
            });
            setTitle("");
            setTemplateId("");
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("tasks.createFail"));
        } finally {
            setCreating(false);
        }
    };

    const removeTask = async (taskId: string) => {
        if (!hasToken) {
            return;
        }
        if (!window.confirm(t("tasks.confirmDelete"))) {
            return;
        }
        setError(null);
        try {
            await apiDeleteTask(taskId);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("tasks.loadFail"));
        }
    };

    return (
        <div className="space-y-4">
            {!hasToken && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100/90">
                    {t("tasks.guestWarnBefore")}
                    <Link to="/login" className="mx-1 font-medium text-claw-700 underline dark:text-claw-300">
                        {t("layout.login")}
                    </Link>
                    {t("tasks.guestWarnAfter")}
                </p>
            )}

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("tasks.filter")}</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="block text-xs text-slate-600 dark:text-slate-400">
                        {t("tasks.status")}
                        <Select
                            className="mt-1"
                            value={status}
                            onChange={(e) => setStatus(e.target.value as TaskStatus | "")}
                        >
                            {STATUSES.map((s) => (
                                <option key={s || "all"} value={s}>
                                    {s ? t(`taskStatus.${s}`) : t("tasks.all")}
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm text-slate-700 dark:text-slate-300">
                        <input
                            type="checkbox"
                            checked={failedOnly}
                            onChange={(e) => setFailedOnly(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-400 dark:border-slate-600"
                        />
                        {t("tasks.failedOnly")}
                    </label>
                    <label className="block text-xs text-slate-600 dark:text-slate-400">
                        {t("tasks.limitLabel")}
                        <Select
                            className="mt-1"
                            value={String(limit)}
                            onChange={(e) => setLimit(Number(e.target.value) || 50)}
                        >
                            {LIMIT_PRESETS.map((n) => (
                                <option key={n} value={String(n)}>
                                    {n}
                                </option>
                            ))}
                        </Select>
                    </label>
                </div>
                <Button type="button" variant="secondary" className="mt-3" onClick={() => void load()}>
                    {t("tasks.refresh")}
                </Button>
            </Card>

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("tasks.newTitle")}</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("tasks.newHint")}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">{t("tasks.templateHint")}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-slate-600 dark:text-slate-400">
                        {t("tasks.template")}
                        <Select
                            className="mt-1"
                            value={templateId}
                            onChange={(e) => {
                                const id = e.target.value;
                                setTemplateId(id);
                                const tpl = templates.find((x) => x.id === id);
                                if (tpl && !title.trim()) {
                                    setTitle(tpl.defaultTitle);
                                }
                            }}
                            disabled={!hasToken}
                        >
                            <option value="">{t("tasks.templateNone")}</option>
                            {templates.map((tpl) => (
                                <option key={tpl.id} value={tpl.id}>
                                    {tpl.id} — {tpl.defaultTitle}
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="block text-xs text-slate-600 dark:text-slate-400 sm:col-span-2">
                        {t("tasks.titlePh")}
                        <Input
                            className="mt-1"
                            placeholder={t("tasks.titlePh")}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={!hasToken}
                        />
                    </label>
                </div>
                <Button
                    type="button"
                    className="mt-3"
                    onClick={() => void create()}
                    disabled={creating || !hasToken}
                >
                    {t("tasks.create")}
                </Button>
            </Card>

            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

            <Card className="overflow-hidden p-0">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("tasks.listTitle")}</h2>
                    <p className="text-xs text-slate-600 dark:text-slate-500">{t("tasks.listHint")}</p>
                </div>
                {loading ? (
                    <p className="p-6 text-center text-slate-500">{t("tasks.loading")}</p>
                ) : tasks.length === 0 ? (
                    <p className="p-6 text-center text-slate-500">{t("tasks.empty")}</p>
                ) : (
                    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                        {tasks.map((task) => (
                            <li key={task.taskId} className="flex items-stretch">
                                <Link
                                    to={`/tasks/${encodeURIComponent(task.taskId)}`}
                                    className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 transition hover:bg-slate-100 dark:hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                                            {task.title}
                                        </p>
                                        <p className="font-mono text-xs text-slate-500">{task.taskId}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <StatusBadge
                                            status={task.status}
                                            label={t(`taskStatus.${task.status}`)}
                                        />
                                        <span className="text-xs text-slate-500">
                                            {formatDateTime(task.updatedAt, locale)}
                                        </span>
                                    </div>
                                </Link>
                                {hasToken && (
                                    <button
                                        type="button"
                                        className="shrink-0 border-l border-slate-200 px-3 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:hover:bg-slate-800/60 dark:hover:text-rose-400"
                                        onClick={() => void removeTask(task.taskId)}
                                    >
                                        {t("tasks.delete")}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
