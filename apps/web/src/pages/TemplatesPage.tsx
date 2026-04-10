import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiTaskTemplates } from "@/api/client";
import type { TaskTemplateSummary } from "@/api/types";
import { useLocale } from "@/locale/LocaleContext";
import { Card } from "@/components/ui";

export function TemplatesPage() {
    const { t } = useLocale();
    const [templates, setTemplates] = useState<TaskTemplateSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setError(null);
            setLoading(true);
            try {
                const { templates: rows } = await apiTaskTemplates();
                if (!cancelled) setTemplates(rows);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : t("tpl.loadFail"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [t]);

    return (
        <div className="space-y-4">
            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("tpl.title")}</h2>
                <p className="text-xs text-slate-600 dark:text-slate-500">{t("tpl.hint")}</p>
                <p className="mt-2 text-xs">
                    <Link to="/workspace" className="text-claw-600 underline dark:text-claw-400">
                        {t("nav.workspace")}
                    </Link>
                </p>
            </Card>

            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

            {loading ? (
                <p className="text-slate-500 dark:text-slate-500">{t("tasks.loading")}</p>
            ) : (
                <ul className="space-y-3">
                    {templates.map((tpl) => (
                        <Card key={tpl.id} className="p-4">
                            <p className="font-mono text-sm text-claw-700 dark:text-claw-300">{tpl.id}</p>
                            <p className="mt-1 text-slate-800 dark:text-slate-100">{tpl.defaultTitle}</p>
                            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
                                {JSON.stringify(tpl.defaultParams, null, 2)}
                            </pre>
                        </Card>
                    ))}
                </ul>
            )}
        </div>
    );
}
