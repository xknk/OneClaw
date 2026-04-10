import { useCallback, useEffect, useMemo, useState } from "react";
import {
    apiWorkspacePaths,
    apiWorkspaceFileAccessGet,
    apiWorkspaceFileAccessPut,
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
import { Button, Card, Input, Select, TextArea } from "@/components/ui";
import { formatDateTime } from "@/lib/formatDateTime";

export function WorkspacePage() {
    const { locale, t } = useLocale();
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [pathsText, setPathsText] = useState("");
    const [fileAccessJson, setFileAccessJson] = useState(
        '{\n  "extraRoots": [],\n  "deniedPrefixes": [],\n  "pathRules": [],\n  "defaultAccess": "full"\n}\n',
    );
    const [fileAccessEnvText, setFileAccessEnvText] = useState("");

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

    const agentIdsFromRegistry = useMemo(() => {
        try {
            const o = JSON.parse(agentsJson) as { agents?: { id?: string }[] };
            if (!Array.isArray(o?.agents)) return ["main"];
            const ids = o.agents
                .map((a) => (typeof a?.id === "string" ? a.id.trim() : ""))
                .filter(Boolean);
            const merged = ["main", ...ids.filter((id) => id !== "main")];
            return Array.from(new Set(merged));
        } catch {
            return ["main"];
        }
    }, [agentsJson]);

    const sessionAgentSelectValue = agentIdsFromRegistry.includes(sessionAgentId.trim())
        ? sessionAgentId.trim()
        : "__custom__";

    const skillFileSelectValue = skillFiles.includes(skillName) ? skillName : "__custom__";

    const loadAll = useCallback(async () => {
        setError(null);
        setOk(null);
        try {
            const paths = await apiWorkspacePaths();
            setPathsText(JSON.stringify(paths, null, 2));

            const fa = await apiWorkspaceFileAccessGet();
            setFileAccessJson(fa.raw);
            setFileAccessEnvText(JSON.stringify(fa.fromEnv, null, 2));

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

    const saveFileAccess = async () => {
        setError(null);
        setOk(null);
        try {
            let parsed: unknown;
            try {
                parsed = JSON.parse(fileAccessJson) as unknown;
            } catch (parseErr) {
                if (parseErr instanceof SyntaxError) {
                    setError(t("workspace.fileAccessJsonSyntaxError"));
                    return;
                }
                throw parseErr;
            }
            if (!parsed || typeof parsed !== "object") {
                setError(t("workspace.needFileAccessJson"));
                return;
            }
            const extraRoots = (parsed as { extraRoots?: unknown }).extraRoots;
            const deniedPrefixes = (parsed as { deniedPrefixes?: unknown }).deniedPrefixes;
            const pathRulesRaw = (parsed as { pathRules?: unknown }).pathRules;
            const defaultAccessRaw = (parsed as { defaultAccess?: unknown }).defaultAccess;
            if (!Array.isArray(extraRoots) || !Array.isArray(deniedPrefixes)) {
                setError(t("workspace.needFileAccessJson"));
                return;
            }
            if (!extraRoots.every((x) => typeof x === "string") || !deniedPrefixes.every((x) => typeof x === "string")) {
                setError(t("workspace.needFileAccessJson"));
                return;
            }
            if (pathRulesRaw !== undefined && !Array.isArray(pathRulesRaw)) {
                setError(t("workspace.needFileAccessJson"));
                return;
            }
            const pathRules: { path: string; access: "read" | "write" | "full" }[] = [];
            if (Array.isArray(pathRulesRaw)) {
                for (const item of pathRulesRaw) {
                    if (!item || typeof item !== "object") {
                        setError(t("workspace.needFileAccessJson"));
                        return;
                    }
                    const p = (item as { path?: unknown }).path;
                    const a = (item as { access?: unknown }).access;
                    if (typeof p !== "string" || (a !== "read" && a !== "write" && a !== "full")) {
                        setError(t("workspace.needFileAccessJson"));
                        return;
                    }
                    pathRules.push({ path: p, access: a });
                }
            }
            let defaultAccess: "read" | "write" | "full" = "full";
            if (defaultAccessRaw !== undefined) {
                if (defaultAccessRaw !== "read" && defaultAccessRaw !== "write" && defaultAccessRaw !== "full") {
                    setError(t("workspace.needFileAccessJson"));
                    return;
                }
                defaultAccess = defaultAccessRaw;
            }
            await apiWorkspaceFileAccessPut({
                extraRoots,
                deniedPrefixes,
                pathRules,
                defaultAccess,
            });
            setOk(t("workspace.savedFileAccess"));
            await loadAll();
        } catch (e) {
            setError(e instanceof Error ? e.message : t("workspace.saveFail"));
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
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("workspace.fileAccessTitle")}</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">{t("workspace.fileAccessHint")}</p>
                <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">{t("workspace.fileAccessEnvLabel")}</p>
                <pre className="mt-1 max-h-32 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
                    {fileAccessEnvText || "{}"}
                </pre>
                <TextArea
                    className="mt-2 min-h-[200px] font-mono text-xs"
                    value={fileAccessJson}
                    onChange={(e) => setFileAccessJson(e.target.value)}
                />
                <Button type="button" className="mt-2" onClick={() => void saveFileAccess()}>
                    {t("workspace.save")}
                </Button>
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
                <label className="mt-2 block text-xs text-slate-600 dark:text-slate-400">
                    {t("workspace.skillPick")}
                    <Select
                        className="mt-1 font-mono text-xs"
                        value={skillFileSelectValue}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") {
                                return;
                            }
                            if (v === "__custom__") {
                                if (skillFiles.includes(skillName)) {
                                    setSkillName("");
                                }
                            } else {
                                void loadSkillFile(v);
                            }
                        }}
                    >
                        <option value="">{t("workspace.skillPickPlaceholder")}</option>
                        {skillFiles.map((f) => (
                            <option key={f} value={f}>
                                {f}
                            </option>
                        ))}
                        <option value="__custom__">{t("workspace.skillCustom")}</option>
                    </Select>
                </label>
                {(skillFileSelectValue === "__custom__" || !skillFiles.includes(skillName)) && (
                    <label className="mt-3 block text-xs text-slate-600 dark:text-slate-400">
                        {t("workspace.skillFileName")}
                        <Input
                            className="mt-1 font-mono text-xs"
                            value={skillName}
                            onChange={(e) => setSkillName(e.target.value)}
                        />
                    </label>
                )}
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
                    {t("workspace.sessionAgentPick")}
                    <Select
                        className="mt-1 font-mono text-xs"
                        value={sessionAgentSelectValue}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") {
                                if (agentIdsFromRegistry.includes(sessionAgentId.trim())) {
                                    setSessionAgentId("");
                                }
                            } else {
                                setSessionAgentId(v);
                            }
                        }}
                    >
                        {agentIdsFromRegistry.map((id) => (
                            <option key={id} value={id}>
                                {id}
                            </option>
                        ))}
                        <option value="__custom__">{t("workspace.sessionAgentCustom")}</option>
                    </Select>
                </label>
                {sessionAgentSelectValue === "__custom__" && (
                    <label className="mt-2 block text-xs text-slate-600 dark:text-slate-400">
                        agentId
                        <Input
                            className="mt-1 font-mono text-xs"
                            value={sessionAgentId}
                            onChange={(e) => setSessionAgentId(e.target.value)}
                        />
                    </label>
                )}
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
