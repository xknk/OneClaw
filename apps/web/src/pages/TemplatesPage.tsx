import { useEffect, useState } from "react";
import { apiTaskTemplates } from "@/api/client";
import type { TaskTemplateSummary } from "@/api/types";
import { Card } from "@/components/ui";

export function TemplatesPage() {
    const [templates, setTemplates] = useState<TaskTemplateSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setError(null);
            setLoading(true);
            try {
                const { templates: t } = await apiTaskTemplates();
                if (!cancelled) setTemplates(t);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="space-y-4">
            <Card className="p-4">
                <h2 className="text-sm font-semibold text-white">任务模板</h2>
                <p className="text-xs text-slate-500">GET /api/task-templates</p>
            </Card>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            {loading ? (
                <p className="text-slate-500">加载中…</p>
            ) : (
                <ul className="space-y-3">
                    {templates.map((t) => (
                        <Card key={t.id} className="p-4">
                            <p className="font-mono text-sm text-claw-300">{t.id}</p>
                            <p className="mt-1 text-slate-100">{t.defaultTitle}</p>
                            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950/80 p-2 font-mono text-[11px] text-slate-400">
                                {JSON.stringify(t.defaultParams, null, 2)}
                            </pre>
                        </Card>
                    ))}
                </ul>
            )}
        </div>
    );
}
