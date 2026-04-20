/**
 * 工作区与运行时配置 API：MCP、任务模板、Skills、Agent 注册表、会话管理。
 * 供 Web 与 TUI 用户在不改代码的情况下维护网关行为。
 */

import type express from "express";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { appConfig } from "@/config/evn";
import { getConfigDir, getTaskTemplatesFilePath } from "@/config/runtimePaths";
import { parseMcpServerConfigs, resolveMcpServersFilePathForAdmin } from "@/config/mcpConfig";
import { invalidateMcpRoutingCache } from "@/tools/mcpRegistry";
import { redactForLog } from "@/util/redact";
import { loadAgentRegistryFromWorkspace, getAgentRegistryPath } from "@/agent/loadAgentRegistry";
import {
    listSessionEntries,
    deleteSessionEntry,
    type SessionListEntry,
} from "@/session/store";
import { TASK_TEMPLATE_REGISTRY } from "@/tasks/templates";
import type { TaskTemplateDefinition } from "@/tasks/templates";
import { loadDynamicTaskTemplates } from "@/tasks/dynamicTaskTemplates";
import {
    ensureFileAccessPolicyReady,
    getDefaultAccessLevel,
    getEnvOnlyFileAccessParts,
    getFileAccessDeniedPrefixes,
    getFileAccessRoots,
    getPathRules,
    readFileAccessJsonFile,
    readFileAccessJsonRaw,
    reloadFileAccessPolicyAfterFileWrite,
    resolveFileAccessJsonPath,
} from "@/config/fileAccessPolicy";
import {
    getModelsFilePath,
    invalidateModelsCatalogCache,
    loadModelsCatalog,
    parseModelsCatalog,
    readModelsCatalogRaw,
} from "@/llm/modelCatalog";

function safeSkillJsonBasename(name: string): string {
    const base = path.basename(name.trim());
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(base)) {
        throw new Error("技能文件名须为 .json，且仅含字母数字、._-");
    }
    return base;
}

function skillsJsonDir(): string {
    return path.join(appConfig.skillsDir, "skills");
}

async function ensureDir(p: string): Promise<void> {
    await fs.mkdir(p, { recursive: true });
}

async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
    await ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmp, filePath);
}

export type WorkspacePathsResponse = {
    dataDir: string;
    configDir: string;
    skillsDir: string;
    userWorkspaceDir: string;
    projectRootDir: string;
    mcpServersFile: string;
    taskTemplatesFile: string;
    modelsFile: string;
    agentsRegistryFile: string;
    skillsJsonDir: string;
    /** read/search/apply_patch 允许的根目录（含主 workspace 与额外根） */
    fileAccessRoots: string[];
    /** 一律禁止读写的路径前缀 */
    fileAccessDeniedPrefixes: string[];
    /** file-access.json 路径（可与 Web「文件访问」编辑对应） */
    fileAccessJsonPath: string;
};

function buildPathsPayload(): WorkspacePathsResponse {
    ensureFileAccessPolicyReady();
    return {
        dataDir: path.resolve(appConfig.dataDir),
        configDir: path.resolve(getConfigDir()),
        skillsDir: path.resolve(appConfig.skillsDir),
        userWorkspaceDir: path.resolve(appConfig.userWorkspaceDir),
        projectRootDir: path.resolve(appConfig.projectRootDir),
        mcpServersFile: path.resolve(resolveMcpServersFilePathForAdmin()),
        taskTemplatesFile: path.resolve(getTaskTemplatesFilePath()),
        modelsFile: path.resolve(getModelsFilePath()),
        agentsRegistryFile: path.resolve(getAgentRegistryPath()),
        skillsJsonDir: path.resolve(skillsJsonDir()),
        fileAccessRoots: getFileAccessRoots().map((r) => path.resolve(r)),
        fileAccessDeniedPrefixes: getFileAccessDeniedPrefixes().map((r) => path.resolve(r)),
        fileAccessJsonPath: path.resolve(resolveFileAccessJsonPath()),
    };
}

export function registerWorkspaceRoutes(app: express.Application): void {
    app.get("/api/workspace/paths", (_req, res) => {
        try {
            res.json(buildPathsPayload());
        } catch (err) {
            console.error("/api/workspace/paths:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    /**
     * 模型配置：models.json（供 Web 配置可选模型列表）
     */
    app.get("/api/workspace/models", (_req, res) => {
        try {
            const raw = readModelsCatalogRaw();
            const catalog = loadModelsCatalog();
            res.json({
                filePath: raw.filePath,
                fileExists: raw.exists,
                catalog,
                rawText: raw.rawText,
            });
        } catch (err) {
            console.error("/api/workspace/models GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.put("/api/workspace/models", async (req, res) => {
        try {
            const body = req.body ?? {};
            // 兼容两种形态：直接传 catalog，或 { catalog: ... }
            const rawCatalog = (body as any).catalog ?? body;
            const parsed = parseModelsCatalog(rawCatalog);
            const filePath = getModelsFilePath();
            await writeJsonFileAtomic(filePath, parsed);
            invalidateModelsCatalogCache();
            res.json({ ok: true, filePath, catalog: parsed });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            // 大多是校验错误，按 400 返回更友好
            const code = msg.includes("格式错误") ? 400 : 500;
            if (code === 500) console.error("/api/workspace/models PUT:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });

    app.get("/api/workspace/file-access", (_req, res) => {
        try {
            ensureFileAccessPolicyReady();
            const { filePath, raw, exists } = readFileAccessJsonRaw();
            const fromEnv = getEnvOnlyFileAccessParts();
            const json = readFileAccessJsonFile();
            res.json({
                filePath,
                raw,
                fileExists: exists,
                fromEnv,
                json,
                effective: {
                    roots: getFileAccessRoots().map((r) => path.resolve(r)),
                    deniedPrefixes: getFileAccessDeniedPrefixes().map((r) => path.resolve(r)),
                    defaultAccess: getDefaultAccessLevel(),
                    pathRules: getPathRules(),
                },
                hotReload: true,
            });
        } catch (err) {
            console.error("/api/workspace/file-access GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.put("/api/workspace/file-access", async (req, res) => {
        try {
            const body = req.body as {
                extraRoots?: unknown;
                deniedPrefixes?: unknown;
                pathRules?: unknown;
                defaultAccess?: unknown;
            };
            if (
                !body ||
                typeof body !== "object" ||
                !Array.isArray(body.extraRoots) ||
                !Array.isArray(body.deniedPrefixes)
            ) {
                res.status(400).json({
                    error: "请求体须为 JSON 对象，且包含 extraRoots、deniedPrefixes（字符串数组）",
                });
                return;
            }
            if (
                !body.extraRoots.every((x) => typeof x === "string") ||
                !body.deniedPrefixes.every((x) => typeof x === "string")
            ) {
                res.status(400).json({ error: "extraRoots 与 deniedPrefixes 的元素须为字符串路径" });
                return;
            }
            let pathRules: { path: string; access: string }[] = [];
            if (body.pathRules !== undefined) {
                if (!Array.isArray(body.pathRules)) {
                    res.status(400).json({ error: "pathRules 须为数组" });
                    return;
                }
                for (const item of body.pathRules) {
                    if (!item || typeof item !== "object") {
                        res.status(400).json({ error: "pathRules 每项须为对象" });
                        return;
                    }
                    const p = (item as { path?: unknown }).path;
                    const a = (item as { access?: unknown }).access;
                    if (typeof p !== "string" || typeof a !== "string") {
                        res.status(400).json({ error: "pathRules 每项须含 path、access 字符串" });
                        return;
                    }
                    if (a !== "read" && a !== "write" && a !== "full") {
                        res.status(400).json({ error: "pathRules.access 须为 read、write 或 full" });
                        return;
                    }
                    pathRules.push({ path: p, access: a });
                }
            }
            let defaultAccess: "read" | "write" | "full" = "full";
            if (body.defaultAccess !== undefined) {
                const d = body.defaultAccess;
                if (d !== "read" && d !== "write" && d !== "full") {
                    res.status(400).json({ error: "defaultAccess 须为 read、write 或 full" });
                    return;
                }
                defaultAccess = d;
            }
            const filePath = resolveFileAccessJsonPath();
            await writeJsonFileAtomic(filePath, {
                extraRoots: body.extraRoots,
                deniedPrefixes: body.deniedPrefixes,
                pathRules,
                defaultAccess,
            });
            reloadFileAccessPolicyAfterFileWrite();
            res.json({ ok: true, filePath });
        } catch (err) {
            console.error("/api/workspace/file-access PUT:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.get("/api/workspace/mcp", (_req, res) => {
        try {
            const filePath = resolveMcpServersFilePathForAdmin();
            let raw: unknown = [];
            if (fsSync.existsSync(filePath)) {
                raw = JSON.parse(fsSync.readFileSync(filePath, "utf8")) as unknown;
            }
            const configs = parseMcpServerConfigs(raw);
            res.json({
                filePath,
                configs,
                raw: Array.isArray(raw) ? raw : [],
            });
        } catch (err) {
            console.error("/api/workspace/mcp GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.put("/api/workspace/mcp", async (req, res) => {
        try {
            const body = req.body;
            const raw = Array.isArray(body) ? body : (body as { servers?: unknown })?.servers;
            if (!Array.isArray(raw)) {
                res.status(400).json({ error: "请求体须为 MCP 服务器对象数组，或 { servers: [...] }" });
                return;
            }
            const filePath = resolveMcpServersFilePathForAdmin();
            await writeJsonFileAtomic(filePath, raw);
            invalidateMcpRoutingCache();
            const configs = parseMcpServerConfigs(raw);
            res.json({ ok: true, filePath, configs });
        } catch (err) {
            console.error("/api/workspace/mcp PUT:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.get("/api/workspace/task-templates", (_req, res) => {
        try {
            const filePath = getTaskTemplatesFilePath();
            const dynamic = loadDynamicTaskTemplates();
            const templates: TaskTemplateDefinition[] = Object.values(dynamic);
            const builtInIds = Object.keys(TASK_TEMPLATE_REGISTRY);
            res.json({
                filePath,
                templates,
                builtInTemplateIds: builtInIds,
                fileExists: fsSync.existsSync(filePath),
            });
        } catch (err) {
            console.error("/api/workspace/task-templates GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.put("/api/workspace/task-templates", async (req, res) => {
        try {
            const body = req.body ?? {};
            const templatesRaw = (body as { templates?: unknown }).templates;
            if (!Array.isArray(templatesRaw)) {
                res.status(400).json({ error: "body.templates 须为数组（可为空，表示仅使用内置模板）" });
                return;
            }
            const filePath = getTaskTemplatesFilePath();
            await writeJsonFileAtomic(filePath, { templates: templatesRaw });
            res.json({ ok: true, filePath, count: templatesRaw.length });
        } catch (err) {
            console.error("/api/workspace/task-templates PUT:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.get("/api/workspace/skills", async (_req, res) => {
        try {
            const dir = skillsJsonDir();
            await ensureDir(dir);
            const names = await fs.readdir(dir);
            const files = names.filter((n) => n.endsWith(".json")).sort();
            res.json({ dir, files });
        } catch (err) {
            console.error("/api/workspace/skills GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.get("/api/workspace/skills/:name", async (req, res) => {
        try {
            const base = safeSkillJsonBasename(req.params.name);
            const dir = skillsJsonDir();
            const full = path.join(dir, base);
            const resolved = path.resolve(full);
            if (path.dirname(resolved) !== path.resolve(dir)) {
                res.status(400).json({ error: "非法路径" });
                return;
            }
            if (!fsSync.existsSync(resolved)) {
                res.status(404).json({ error: "文件不存在" });
                return;
            }
            const text = await fs.readFile(resolved, "utf-8");
            res.type("application/json; charset=utf-8");
            res.send(text);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("非法") ? 400 : 500;
            if (code === 500) console.error("/api/workspace/skills/:name GET:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });

    app.put("/api/workspace/skills/:name", async (req, res) => {
        try {
            const base = safeSkillJsonBasename(req.params.name);
            const dir = skillsJsonDir();
            await ensureDir(dir);
            const full = path.join(dir, base);
            const body = req.body;
            const jsonText =
                typeof body === "string"
                    ? body
                    : JSON.stringify(body ?? {}, null, 2);
            JSON.parse(jsonText);
            await fs.writeFile(full, jsonText, "utf-8");
            res.json({ ok: true, path: full });
        } catch (err) {
            console.error("/api/workspace/skills PUT:", redactForLog(err));
            res.status(400).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.delete("/api/workspace/skills/:name", async (req, res) => {
        try {
            const base = safeSkillJsonBasename(req.params.name);
            const dir = skillsJsonDir();
            const full = path.join(dir, base);
            try {
                await fs.unlink(full);
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                    res.status(404).json({ error: "文件不存在" });
                    return;
                }
                throw e;
            }
            res.json({ ok: true });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            const code = msg.includes("非法") ? 400 : 500;
            if (code === 500) console.error("/api/workspace/skills DELETE:", redactForLog(err));
            res.status(code).json({ error: msg });
        }
    });

    app.get("/api/workspace/agents", async (_req, res) => {
        try {
            const filePath = getAgentRegistryPath();
            if (!fsSync.existsSync(filePath)) {
                res.json({
                    filePath,
                    exists: false,
                    registry: { agents: [], bindings: [] } as const,
                });
                return;
            }
            const text = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(text) as unknown;
            res.json({ filePath, exists: true, registry: parsed });
        } catch (err) {
            console.error("/api/workspace/agents GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.put("/api/workspace/agents", async (req, res) => {
        try {
            const body = req.body ?? {};
            const filePath = getAgentRegistryPath();
            await ensureDir(path.dirname(filePath));
            await writeJsonFileAtomic(filePath, body);
            await loadAgentRegistryFromWorkspace();
            res.json({ ok: true, filePath });
        } catch (err) {
            console.error("/api/workspace/agents PUT:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.get("/api/workspace/sessions", async (req, res) => {
        try {
            const agentId =
                typeof req.query.agentId === "string" && req.query.agentId.trim() !== ""
                    ? req.query.agentId.trim()
                    : "main";
            const rows: SessionListEntry[] = await listSessionEntries(agentId);
            res.json({ agentId, sessions: rows });
        } catch (err) {
            console.error("/api/workspace/sessions GET:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    app.delete("/api/workspace/sessions", async (req, res) => {
        try {
            const body = req.body ?? {};
            const sessionKey =
                typeof body.sessionKey === "string" && body.sessionKey.trim() !== ""
                    ? body.sessionKey.trim()
                    : "";
            const agentId =
                typeof body.agentId === "string" && body.agentId.trim() !== ""
                    ? body.agentId.trim()
                    : "main";
            if (!sessionKey) {
                res.status(400).json({ error: "body.sessionKey 必填" });
                return;
            }
            const ok = await deleteSessionEntry(sessionKey, agentId);
            if (!ok) {
                res.status(404).json({ error: "会话不存在" });
                return;
            }
            res.json({ ok: true });
        } catch (err) {
            console.error("/api/workspace/sessions DELETE:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });
}
