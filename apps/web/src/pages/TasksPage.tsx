import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { apiCreateTask, apiListTasks } from "@/api/client";
import type { TaskRecord, TaskStatus } from "@/api/types";
import { Button, Card, Input, Select, StatusBadge } from "@/components/ui";

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
    const [tasks, setTasks] = useState<TaskRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<TaskStatus | "">("");
    const [failedOnly, setFailedOnly] = useState(false);
    const [limit, setLimit] = useState(50);
    const [title, setTitle] = useState("");
    const [creating, setCreating] = useState(false);

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
            setError(e instanceof Error ? e.message : "加载失败");
        } finally {
            setLoading(false);
        }
    }, [failedOnly, limit, status]);

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
            await apiCreateTask({ title: title.trim() || undefined });
            setTitle("");
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "创建失败");
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="space-y-4">
            {!hasToken && (
                <p className="rounded-xl border border-amber-900/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100/90">
                    访客无法创建任务。请
                    <Link to="/login" className="mx-1 font-medium text-claw-300 underline">
                        登录
                    </Link>
                    并保存网关令牌（首次将自动在本机注册）。
                </p>
            )}

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-white">筛选</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="block text-xs text-slate-400">
                        状态
                        <Select
                            className="mt-1"
                            value={status}
                            onChange={(e) => setStatus(e.target.value as TaskStatus | "")}
                        >
                            {STATUSES.map((s) => (
                                <option key={s || "all"} value={s}>
                                    {s || "全部"}
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm text-slate-300">
                        <input
                            type="checkbox"
                            checked={failedOnly}
                            onChange={(e) => setFailedOnly(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-600"
                        />
                        仅失败
                    </label>
                    <label className="block text-xs text-slate-400">
                        limit
                        <Input
                            className="mt-1"
                            type="number"
                            min={1}
                            max={500}
                            value={limit}
                            onChange={(e) => setLimit(Number(e.target.value) || 50)}
                        />
                    </label>
                </div>
                <Button type="button" variant="secondary" className="mt-3" onClick={() => void load()}>
                    刷新
                </Button>
            </Card>

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-white">新建任务</h2>
                <p className="mt-1 text-xs text-slate-500">仅登录用户可创建（需本地已保存 WebChat 令牌）。</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                        placeholder="标题（可选）"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={!hasToken}
                    />
                    <Button type="button" onClick={() => void create()} disabled={creating || !hasToken}>
                        创建
                    </Button>
                </div>
            </Card>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <Card className="overflow-hidden p-0">
                <div className="border-b border-slate-800 px-4 py-3">
                    <h2 className="text-sm font-semibold text-white">任务列表</h2>
                    <p className="text-xs text-slate-500">对应 GET /api/tasks</p>
                </div>
                {loading ? (
                    <p className="p-6 text-center text-slate-500">加载中…</p>
                ) : tasks.length === 0 ? (
                    <p className="p-6 text-center text-slate-500">暂无任务</p>
                ) : (
                    <ul className="divide-y divide-slate-800">
                        {tasks.map((t) => (
                            <li key={t.taskId}>
                                <Link
                                    to={`/tasks/${encodeURIComponent(t.taskId)}`}
                                    className="flex flex-col gap-1 px-4 py-3 transition hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-slate-100">{t.title}</p>
                                        <p className="font-mono text-xs text-slate-500">{t.taskId}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <StatusBadge status={t.status} />
                                        <span className="text-xs text-slate-500">
                                            {new Date(t.updatedAt).toLocaleString()}
                                        </span>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
