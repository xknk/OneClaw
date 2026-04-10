import { useCallback, useEffect, useState } from "react";
import {
    apiWorkspacePaths,
    apiWorkspaceMcpGet,
    apiWorkspaceMcpPut,
    apiWorkspaceTaskTemplatesGet,
    apiWorkspaceTaskTemplatesPut,
    apiWorkspaceSkillsList,
    apiWorkspaceSkillGet,
    apiWorkspaceSkillPut,
    apiWorkspaceSkillDelete,
    apiWorkspaceAgentsGet,
    apiWorkspaceAgentsPut,
    apiWorkspaceSessionsList,
    apiWorkspaceSessionDelete,
} from "@/api/client";
import { useLocale } from "@/locale/LocaleContext";
import { Button, Card, Input, TextArea } from "@/components/ui";
import { formatDateTime } from "@/lib/formatDateTime";

export function WorkspacePage() {
    const { locale, t } = useLocale();
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [pathsText, setPathsText] = useState("");

    const [mcpJson, setMcpJson] = useState("[]");
    const [tplJson, setTplJson] = useState("[]");
    const [agentsJson, setAgentsJson] = useState("{}");

    const [skillFiles, setSkillFiles] = useState<string[]>([]);
    const [skillName, setSkillName] = useState("my-skill.json");
    const [skillBody, setSkillBody] = useState("{}");

    const [sessions, setSessions] = useState<{ sessionKey: string; sessionId: string; updatedAt: string }[]>(
        [],
    );
    const [sessionAgentId, setSessionAgentId] = useState("main");

    const loadAll = useCallback(async () => {
        setError(null);
        setOk(null);
        try {
            const paths = await apiWorkspacePaths();
            setPathsText(JSON.stringify(paths, null, 2));

            const mcp = await apiWorkspaceMcpGet();
            setMcpJson(JSON.stringify(mcp.raw?.length ? mcp.raw : [], null, 2));

            const wt = await apiWorkspaceTaskTemplatesGet();
            setTplJson(JSON.stringify(wt.templates, null, 2));

            const ag = await apiWorkspaceAgentsGet();
            setAgentsJson(JSON.stringify(ag.registry ?? { agents: [], bindings: [] }, null, 2));

            const sk = await apiWorkspaceSkillsList();
            setSkillFiles(sk.files);

            const ss = await apiWorkspaceSessionsList(sessionAgentId);
            setSessions(ss.sessions);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.loadFail"));
        }
    }, [sessionAgentId, t]);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    const loadSkillFile = async (name: string) => {
        setError(null);
        try {
            const text = await apiWorkspaceSkillGet(name);
            setSkillBody(text);
            setSkillName(name);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.loadFail"));
        }
    };

    const saveMcp = async () => {
        setError(null);
        setOk(null);
        try {
            const raw = JSON.parse(mcpJson) as unknown;
            if (!Array.isArray(raw)) {
                setError(t("workspace.needMcpArray"));
                return;
            }
            await apiWorkspaceMcpPut(raw);
            setOk(t("workspace.savedMcp"));
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
        }
    };

    const saveTemplates = async () => {
        setError(null);
        setOk(null);
        try {
            const templates = JSON.parse(tplJson) as unknown;
            if (!Array.isArray(templates)) {
                setError(t("workspace.needTplArray"));
                return;
            }
            await apiWorkspaceTaskTemplatesPut(templates);
            setOk(t("workspace.savedTemplates"));
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
        }
    };

    const saveAgents = async () => {
        setError(null);
        setOk(null);
        try {
            const reg = JSON.parse(agentsJson) as unknown;
            await apiWorkspaceAgentsPut(reg);
            setOk(t("workspace.savedAgents"));
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
        }
    };

    const saveSkill = async () => {
        setError(null);
        setOk(null);
        try {
            const parsed = JSON.parse(skillBody) as unknown;
            await apiWorkspaceSkillPut(skillName.trim(), parsed);
            setOk(t("workspace.savedSkill"));
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
        }
    };

    const deleteSkill = async () => {
        if (!window.confirm(t("workspace.confirmDeleteSkill"))) {
            return;
        }
        setError(null);
        try {
            await apiWorkspaceSkillDelete(skillName.trim());
            setOk(t("workspace.deletedSkill"));
            setSkillBody("{}");
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
        }
    };

    const deleteSession = async (sessionKey: string) => {
        if (!window.confirm(t("workspace.confirmDeleteSession"))) {
            return;
        }
        setError(null);
        try {
            await apiWorkspaceSessionDelete({ sessionKey, agentId: sessionAgentId });
            setOk(t("workspace.deletedSession"));
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
        }
    };

    return (
        <div className="space-y-4">
            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("workspace.title")}</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.intro")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => void loadAll()}>
                        {t("workspace.reload")}
                    </Button>
                </div>
            </Card>

            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            {ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">{ok}</p>}

            <Card className="p-4">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.pathsTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.pathsHint")}</p>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
                    {pathsText || "—"}
                </pre>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.mcpTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.mcpHint")}</p>
                <TextArea
                    className="mt-2 min-h-[160px] font-mono text-xs"
                    value={mcpJson}
                    onChange={(e) => setMcpJson(e.target.value)}
                />
                <Button type="button" className="mt-2" onClick={() => void saveMcp()}>
                    {t("workspace.save")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.tplTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.tplHint")}</p>
                <TextArea
                    className="mt-2 min-h-[200px] font-mono text-xs"
                    value={tplJson}
                    onChange={(e) => setTplJson(e.target.value)}
                />
                <Button type="button" className="mt-2" onClick={() => void saveTemplates()}>
                    {t("workspace.save")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.skillsTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.skillsHint")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                    {skillFiles.map((f) => (
                        <Button
                            key={f}
                            type="button"
                            variant="secondary"
                            className="text-xs"
                            onClick={() => void loadSkillFile(f)}
                        >
                            {f}
                        </Button>
                    ))}
                </div>
                <label className="mt-3 block text-xs text-slate-600 dark:text-slate-400">
                    {t("workspace.skillFileName")}
                    <Input
                        className="mt-1 font-mono text-xs"
                        value={skillName}
                        onChange={(e) => setSkillName(e.target.value)}
                    />
                </label>
                <TextArea
                    className="mt-2 min-h-[180px] font-mono text-xs"
                    value={skillBody}
                    onChange={(e) => setSkillBody(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void saveSkill()}>
                        {t("workspace.saveSkill")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void deleteSkill()}>
                        {t("workspace.deleteSkill")}
                    </Button>
                </div>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.agentsTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.agentsHint")}</p>
                <TextArea
                    className="mt-2 min-h-[200px] font-mono text-xs"
                    value={agentsJson}
                    onChange={(e) => setAgentsJson(e.target.value)}
                />
                <Button type="button" className="mt-2" onClick={() => void saveAgents()}>
                    {t("workspace.save")}
                </Button>
            </Card>

            <Card className="p-4">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.sessionsTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.sessionsHint")}</p>
                <label className="mt-2 block text-xs text-slate-600 dark:text-slate-400">
                    agentId
                    <Input
                        className="mt-1 font-mono text-xs"
                        value={sessionAgentId}
                        onChange={(e) => setSessionAgentId(e.target.value)}
                    />
                </label>
                <Button type="button" variant="secondary" className="mt-2" onClick={() => void loadAll()}>
                    {t("workspace.reloadSessions")}
                </Button>
                {sessions.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">{t("workspace.noSessions")}</p>
                ) : (
                    <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                        {sessions.map((s) => (
                            <li key={s.sessionKey} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <p className="truncate font-mono text-xs text-claw-700 dark:text-claw-300">{s.sessionKey}</p>
                                    <p className="font-mono text-[10px] text-slate-500">{s.sessionId}</p>
                                    <p className="text-[10px] text-slate-500">
                                        {formatDateTime(s.updatedAt, locale)}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    className="shrink-0 text-xs text-rose-700 dark:text-rose-300"
                                    onClick={() => void deleteSession(s.sessionKey)}
                                >
                                    {t("workspace.deleteSession")}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
