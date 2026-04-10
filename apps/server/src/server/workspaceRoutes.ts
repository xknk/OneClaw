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
    agentsRegistryFile: string;
    skillsJsonDir: string;
};

function buildPathsPayload(): WorkspacePathsResponse {
    return {
        dataDir: path.resolve(appConfig.dataDir),
        configDir: path.resolve(getConfigDir()),
        skillsDir: path.resolve(appConfig.skillsDir),
        userWorkspaceDir: path.resolve(appConfig.userWorkspaceDir),
        projectRootDir: path.resolve(appConfig.projectRootDir),
        mcpServersFile: path.resolve(resolveMcpServersFilePathForAdmin()),
        taskTemplatesFile: path.resolve(getTaskTemplatesFilePath()),
        agentsRegistryFile: path.resolve(getAgentRegistryPath()),
        skillsJsonDir: path.resolve(skillsJsonDir()),
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
