import type { TaskRecord, TaskStatus, TaskTemplateSummary } from "./types";
import type { UiLocale } from "@/locale/types";

const TOKEN_KEY = "oneclaw.webchat.token";

export function getToken(): string {
    return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}

function buildHeaders(init?: RequestInit): HeadersInit {
    const h: Record<string, string> = {};
    const t = getToken().trim();
    if (t) {
        h.Authorization = `Bearer ${t}`;
    }
    if (init?.body != null) {
        h["Content-Type"] = "application/json";
    }
    return { ...h, ...(init?.headers as Record<string, string> | undefined) };
}

async function parseError(res: Response, bodyText: string): Promise<string> {
    try {
        const j = JSON.parse(bodyText) as { error?: string };
        if (j?.error) return j.error;
    } catch {
        /* ignore */
    }
    return `${res.status} ${res.statusText}`;
}

export type AuthStatusResponse = {
    webchatTokenRequired: boolean;
    /** 网关 ONECLAW_UI_LOCALE，供 Web 默认界面语言 */
    uiLocale: UiLocale;
};

/**
 * 不附带 Authorization，用于启动时探测服务端是否配置了 WEBCHAT_TOKEN。
 */
export async function apiAuthStatus(): Promise<AuthStatusResponse> {
    const res = await fetch("/api/auth/status");
    const text = await res.text();
    if (!res.ok) {
        throw new Error(await parseError(res, text));
    }
    const j = JSON.parse(text) as Partial<AuthStatusResponse>;
    return {
        webchatTokenRequired: Boolean(j.webchatTokenRequired),
        uiLocale: j.uiLocale === "en" ? "en" : "zh",
    };
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: buildHeaders(init),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(await parseError(res, text));
    }
    if (!text) {
        return undefined as T;
    }
    return JSON.parse(text) as T;
}

export type ChatResponse = {
    reply: string;
    /** 服务端返回：taskStatus、待审批快照、无任务时会话级挂起等 */
    metadata?: Record<string, unknown>;
};

export type ChatRequestBody = {
    message: string;
    sessionKey?: string;
    agentId?: string;
    modelId?: string;
    intent?: string;
    taskId?: string;
    /** 与任务联用时：为 true 则优先使用下方 agentId，不被计划步 assignedAgentId 覆盖 */
    agentLocked?: boolean;
};

export type ChatStreamCallbacks = {
    signal?: AbortSignal;
    onDelta?: (chunk: string) => void;
    onSse?: (obj: Record<string, unknown>) => void;
};

/**
 * 对话：第二参数传入则走 SSE（stream:true），支持 onDelta 与 AbortSignal。
 */
export async function apiChat(body: ChatRequestBody, stream?: ChatStreamCallbacks): Promise<ChatResponse> {
    if (!stream) {
        return apiJson<ChatResponse>("/api/chat", {
            method: "POST",
            body: JSON.stringify(body),
        });
    }

    const res = await fetch("/api/chat", {
        method: "POST",
        headers: buildHeaders({ body: JSON.stringify({ ...body, stream: true }) }),
        body: JSON.stringify({ ...body, stream: true }),
        signal: stream.signal,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(await parseError(res, text));
    }

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
        const text = await res.text();
        try {
            const j = JSON.parse(text) as ChatResponse;
            return { reply: j.reply ?? "", metadata: j.metadata };
        } catch {
            throw new Error(text || "无效 JSON");
        }
    }

    const reader = res.body?.getReader();
    if (!reader) {
        throw new Error("响应无流式正文");
    }

    const decoder = new TextDecoder();
    let buf = "";
    let reply = "";
    let metadata: Record<string, unknown> | undefined;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            let obj: Record<string, unknown>;
            try {
                obj = JSON.parse(payload) as Record<string, unknown>;
            } catch {
                continue;
            }
            stream.onSse?.(obj);
            if (obj.type === "delta" && typeof obj.text === "string") {
                reply += obj.text;
                stream.onDelta?.(obj.text);
            }
            if (obj.type === "final") {
                if (typeof obj.reply === "string") reply = obj.reply;
                const meta = obj.metadata;
                if (meta && typeof meta === "object" && !Array.isArray(meta)) {
                    metadata = meta as Record<string, unknown>;
                }
            }
            if (obj.type === "error") {
                const err =
                    typeof obj.error === "string" ? obj.error : JSON.stringify(obj);
                throw new Error(err);
            }
        }
    }

    return { reply, metadata };
}

/** 无 taskId 时高风险工具：在聊天页确认后调用，放行下一次同工具调用 */
export async function apiChatApproveRisk(body: { sessionKey: string; agentId?: string }): Promise<{
    ok: boolean;
    toolName: string;
}> {
    return apiJson<{ ok: boolean; toolName: string }>("/api/chat/approve-risk", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export type ModelListResponse = {
    defaultModelId: string;
    models: Array<{ id: string; label: string; driver: "ollama" | "zhipu"; supportsTools: boolean }>;
};

export async function apiModels(): Promise<ModelListResponse> {
    return apiJson<ModelListResponse>("/api/models");
}

export async function apiSessionReset(body: {
    sessionKey?: string;
    agentId?: string;
}): Promise<{ sessionId: string }> {
    return apiJson<{ sessionId: string }>("/api/session/reset", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function apiListTasks(params: {
    limit?: number;
    status?: TaskStatus;
    failedOnly?: boolean;
}): Promise<{ tasks: TaskRecord[] }> {
    const q = new URLSearchParams();
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.status) q.set("status", params.status);
    if (params.failedOnly) q.set("failedOnly", "1");
    const qs = q.toString();
    return apiJson<{ tasks: TaskRecord[] }>(`/api/tasks${qs ? `?${qs}` : ""}`);
}

export async function apiGetTask(taskId: string): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function apiCreateTask(body: {
    title?: string;
    templateId?: string;
    params?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}): Promise<TaskRecord> {
    return apiJson<TaskRecord>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function apiTaskTransition(
    taskId: string,
    body: {
        to: TaskStatus;
        reason?: string;
        meta?: Record<string, unknown>;
        checkpoint?: {
            stepIndex: number;
            label?: string;
            payload?: Record<string, unknown>;
        };
        timelineNote?: string;
        failureReason?: string;
    },
): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/transition`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function apiTaskCancel(taskId: string, reason?: string): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
    });
}

export async function apiTaskRetry(taskId: string, reason?: string): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
    });
}

export async function apiTaskResume(
    taskId: string,
    checkpoint: { stepIndex: number; label?: string; payload?: Record<string, unknown> },
): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/resume`, {
        method: "POST",
        body: JSON.stringify({ checkpoint }),
    });
}

export async function apiTaskNote(
    taskId: string,
    text: string,
    meta?: Record<string, unknown>,
): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/note`, {
        method: "POST",
        body: JSON.stringify(meta ? { text, meta } : { text }),
    });
}

export async function apiTaskTemplates(): Promise<{ templates: TaskTemplateSummary[] }> {
    return apiJson<{ templates: TaskTemplateSummary[] }>("/api/task-templates");
}

export type WorkspacePaths = {
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
    fileAccessRoots: string[];
    fileAccessDeniedPrefixes: string[];
    fileAccessJsonPath: string;
};

export async function apiWorkspacePaths(): Promise<WorkspacePaths> {
    return apiJson<WorkspacePaths>("/api/workspace/paths");
}

export type FileAccessWorkspaceGet = {
    filePath: string;
    raw: string;
    fileExists: boolean;
    fromEnv: { extraRoots: string[]; deniedPrefixes: string[] };
    json: {
        extraRoots: string[];
        deniedPrefixes: string[];
        pathRules: { path: string; access: "read" | "write" | "full" }[];
        defaultAccess: "read" | "write" | "full";
    };
    effective: {
        roots: string[];
        deniedPrefixes: string[];
        defaultAccess: "read" | "write" | "full";
        pathRules: { path: string; access: "read" | "write" | "full" }[];
    };
    hotReload: boolean;
};

export async function apiWorkspaceFileAccessGet(): Promise<FileAccessWorkspaceGet> {
    return apiJson<FileAccessWorkspaceGet>("/api/workspace/file-access");
}

export async function apiWorkspaceFileAccessPut(body: {
    extraRoots: string[];
    deniedPrefixes: string[];
    pathRules: { path: string; access: "read" | "write" | "full" }[];
    defaultAccess: "read" | "write" | "full";
}): Promise<{ ok: boolean; filePath: string }> {
    return apiJson("/api/workspace/file-access", {
        method: "PUT",
        body: JSON.stringify(body),
    });
}

export type McpWorkspaceGet = {
    filePath: string;
    configs: unknown[];
    raw: unknown[];
};

export async function apiWorkspaceMcpGet(): Promise<McpWorkspaceGet> {
    return apiJson<McpWorkspaceGet>("/api/workspace/mcp");
}

export async function apiWorkspaceMcpPut(raw: unknown[]): Promise<{ ok: boolean; filePath: string }> {
    return apiJson("/api/workspace/mcp", {
        method: "PUT",
        body: JSON.stringify(raw),
    });
}

export type TaskTemplatesWorkspaceGet = {
    filePath: string;
    templates: unknown[];
    builtInTemplateIds: string[];
    fileExists: boolean;
};

export async function apiWorkspaceTaskTemplatesGet(): Promise<TaskTemplatesWorkspaceGet> {
    return apiJson<TaskTemplatesWorkspaceGet>("/api/workspace/task-templates");
}

export async function apiWorkspaceTaskTemplatesPut(templates: unknown[]): Promise<{ ok: boolean }> {
    return apiJson("/api/workspace/task-templates", {
        method: "PUT",
        body: JSON.stringify({ templates }),
    });
}

export type ModelsWorkspaceGet = {
    filePath: string;
    fileExists: boolean;
    catalog: unknown;
    rawText: string | null;
};

export async function apiWorkspaceModelsGet(): Promise<ModelsWorkspaceGet> {
    return apiJson<ModelsWorkspaceGet>("/api/workspace/models");
}

export async function apiWorkspaceModelsPut(catalog: unknown): Promise<{ ok: boolean; filePath: string; catalog: unknown }> {
    return apiJson("/api/workspace/models", {
        method: "PUT",
        body: JSON.stringify({ catalog }),
    });
}

export async function apiWorkspaceSkillsList(): Promise<{ dir: string; files: string[] }> {
    return apiJson("/api/workspace/skills");
}

export async function apiWorkspaceSkillGet(name: string): Promise<string> {
    const res = await fetch(`/api/workspace/skills/${encodeURIComponent(name)}`, {
        headers: buildHeaders(),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(await parseError(res, text));
    }
    return text;
}

export async function apiWorkspaceSkillPut(name: string, body: unknown): Promise<void> {
    await apiJson(`/api/workspace/skills/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

export async function apiWorkspaceSkillDelete(name: string): Promise<void> {
    const res = await fetch(`/api/workspace/skills/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: buildHeaders(),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(await parseError(res, text));
    }
}

export async function apiWorkspaceAgentsGet(): Promise<{
    filePath: string;
    exists: boolean;
    registry: unknown;
}> {
    return apiJson("/api/workspace/agents");
}

export async function apiWorkspaceAgentsPut(registry: unknown): Promise<void> {
    await apiJson("/api/workspace/agents", {
        method: "PUT",
        body: JSON.stringify(registry),
    });
}

export async function apiWorkspaceSessionsList(agentId?: string): Promise<{
    agentId: string;
    sessions: { sessionKey: string; sessionId: string; updatedAt: string }[];
}> {
    const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    return apiJson(`/api/workspace/sessions${q}`);
}

export async function apiWorkspaceSessionDelete(body: {
    sessionKey: string;
    agentId?: string;
}): Promise<void> {
    await apiJson("/api/workspace/sessions", {
        method: "DELETE",
        body: JSON.stringify(body),
    });
}

export async function apiDeleteTask(taskId: string): Promise<void> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
        headers: buildHeaders(),
    });
    if (res.status === 204) {
        return;
    }
    const text = await res.text();
    throw new Error(await parseError(res, text));
}

export async function apiTaskUpdate(taskId: string, body: { title?: string }): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}

export async function apiTaskPlan(
    taskId: string,
    body: { steps: unknown; plannerNote?: string },
): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/plan`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function apiTaskReview(
    taskId: string,
    body: {
        outcome: "pass" | "fail";
        summary: string;
        findings?: unknown;
        resumeFromStepIndex?: number;
    },
): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/review`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function apiTaskApprove(taskId: string, comment?: string): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/approve`, {
        method: "POST",
        body: JSON.stringify(comment ? { comment } : {}),
    });
}

export async function apiTaskRun(taskId: string, traceId?: string): Promise<TaskRecord> {
    return apiJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}/run`, {
        method: "POST",
        body: JSON.stringify(traceId ? { traceId } : {}),
    });
}

export async function downloadTaskExport(
    taskId: string,
    format: "json" | "md" | "markdown",
): Promise<void> {
    const res = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/export?format=${encodeURIComponent(format)}`,
        { headers: buildHeaders() },
    );
    const text = await res.text();
    if (!res.ok) {
        throw new Error(await parseError(res, text));
    }
    const blob = new Blob([text], {
        type: format === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `task-${taskId}.${format === "json" ? "json" : "md"}`;
    a.click();
    URL.revokeObjectURL(url);
}
