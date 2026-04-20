/**
 * 内置工具注册表：管理 AI 可以调用的所有外部函数
 */

import type { Tool } from "../types";
import type { ToolSchema } from "../../llm/providers/ModelProvider";
import type { ToolExecutionContext, ToolRiskLevel } from "../../tools/types";
import { deleteFileInWorkspace, listDirInWorkspace, readFileInWorkspace, searchInWorkspace } from "./workspace";
import { applyPatch } from "./applyPatch";
import { controlledExec } from "./controlledExec";
import { appConfig } from "../../config/evn";
import { generateDailyReportTool } from "./generateDailyReport";
import { getRuntimeSkillTool } from "@/skills/toolImplRegistry";
import { executeFetchUrl } from "./fetchUrl";
import { executeHttpRequest } from "./httpRequest";

function getTime(): Tool {
    return {
        name: "get_time",
        description: "返回当前服务器的日期与时间（本地时区）",
        async execute() {
            return new Date().toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "medium" });
        },
    };
}

function echo(): Tool {
    return {
        name: "echo",
        description: "回显传入的 text 参数（多用于联调）",
        async execute(args) {
            const text = args?.text;
            return typeof text === "string" ? text : String(JSON.stringify(args ?? {}));
        },
    };
}

function jsonValidateTool(): Tool {
    return {
        name: "json_validate",
        description:
            "校验一段文本是否为合法 JSON；可选 pretty=true 时返回缩进格式化后的文本，便于阅读 API 响应或配置文件",
        async execute(args) {
            const text = typeof args?.text === "string" ? args.text : "";
            if (!text.trim()) return "缺少参数 text（字符串）";
            const pretty = args?.pretty === true;
            try {
                const parsed = JSON.parse(text) as unknown;
                if (pretty) return JSON.stringify(parsed, null, 2);
                const t = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
                return `合法 JSON（顶层类型: ${t}）`;
            } catch (e) {
                return `非法 JSON: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function fetchUrlTool(): Tool {
    return {
        name: "fetch_url",
        riskLevel: "medium",
        description:
            "HTTP GET 拉取外部网页或公开 API 的文本内容（仅 http/https）。需要文档、changelog、接口说明时优先使用；内网地址默认禁止，可用 ONECLAW_FETCH_ALLOW_PRIVATE_HOSTS 放开",
        async execute(args) {
            return executeFetchUrl(args ?? {});
        },
    };
}

function httpRequestTool(): Tool {
    return {
        name: "http_request",
        riskLevel: "medium",
        description:
            "HTTP 请求（GET/POST/PUT/PATCH/DELETE/HEAD），用于调用公开 REST API。与 fetch_url 共用安全策略与 ONECLAW_FETCH_*；勿在参数中泄露密钥",
        async execute(args) {
            return executeHttpRequest(args ?? {});
        },
    };
}

function listDirectoryTool(): Tool {
    return {
        name: "list_directory",
        description:
            "列出 workspace 内某目录的直接子项（不递归）。path 空字符串或 . 表示主 workspace 根；返回每行 type<TAB>name",
        async execute(args) {
            const p = typeof args?.path === "string" ? args.path : "";
            const maxEntries =
                typeof args?.max_entries === "number" && Number.isFinite(args.max_entries)
                    ? args.max_entries
                    : 200;
            try {
                return await listDirInWorkspace(p, maxEntries);
            } catch (e) {
                return `列目录失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function readFile(): Tool {
    return {
        name: "read_file",
        description:
            "读取允许范围内的文件。path 默认相对主 workspace；若配置了 ONECLAW_FILE_ACCESS_EXTRA_ROOTS 或 file-access.json，也可使用允许根下的绝对路径",
        async execute(args) {
            const path = args?.path;
            if (typeof path !== "string") return "缺少参数 path（字符串）";
            try {
                return await readFileInWorkspace(path);
            } catch (e) {
                return `读取失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function searchFiles(): Tool {
    return {
        name: "search_files",
        description:
            "在允许访问的根下搜索文件。glob 可选如 *.ts；多根时返回绝对路径。content 可选为内容子串",
        async execute(args) {
            const glob = typeof args?.glob === "string" ? args.glob : "**/*";
            const content = typeof args?.content === "string" ? args.content : undefined;
            try {
                const list = await searchInWorkspace(glob, content);
                return list.length ? list.join("\n") : "未找到匹配文件";
            } catch (e) {
                return `搜索失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function deleteFile(): Tool {
    return {
        name: "delete_file",
        riskLevel: "high",
        description:
            "删除允许范围内的文件（需路径级 full 权限）。path 为相对主 workspace 或允许根下的绝对路径；目录删除请用 exec（若允许）",
        async execute(args) {
            const p = args?.path;
            if (typeof p !== "string") return "缺少参数 path（字符串）";
            try {
                return await deleteFileInWorkspace(p);
            } catch (e) {
                return `删除失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function applyPatchTool(): Tool {
    return {
        name: "apply_patch",
        riskLevel: "high",
        description:
            "写入或追加文件。path 相对主 workspace 或允许根下的绝对路径；content 为内容；mode 可选 replace|append",
        async execute(args) {
            const path = args?.path;
            const content = args?.content;
            if (typeof path !== "string") return "缺少参数 path";
            if (typeof content !== "string") return "缺少参数 content";
            const mode = args?.mode === "append" ? "append" : "replace";
            try {
                return await applyPatch({ path, content, mode });
            } catch (e) {
                return `写入失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function execTool(): Tool {
    return {
        name: "exec",
        riskLevel: "high",
        description: "在服务器上执行一条 shell 命令，有超时和输出长度限制。command 为要执行的命令字符串（如 dir、dir /a）",
        async execute(args, ctx?: ToolExecutionContext) {
            const command = args?.command;
            if (!appConfig.execEnabled) {
                return "exec 工具已通过 ONECLAW_EXEC_ENABLED 关闭";
            }
            if (typeof command !== "string") return "缺少参数 command（要执行的命令）";
            const timeoutMs = typeof args?.timeout_ms === "number" ? args.timeout_ms : appConfig.execTimeoutMs;
            const maxChars = typeof args?.max_output_chars === "number" ? args.max_output_chars : appConfig.execMaxOutputChars;
            const result = await controlledExec(command, [], {
                timeoutMs,
                maxOutputChars: maxChars,
                abortSignal: ctx?.abortSignal,
            });
            const out = [
                `exitCode: ${result.exitCode}`,
                result.timedOut ? "（已超时）" : "",
                result.truncated ? "（输出已截断）" : "",
                "stdout:\n" + result.stdout,
                "stderr:\n" + result.stderr,
            ].filter(Boolean).join("\n");
            return out;
        },
    };
}

const tools: Tool[] = [
    getTime(),
    echo(),
    jsonValidateTool(),
    fetchUrlTool(),
    httpRequestTool(),
    listDirectoryTool(),
    readFile(),
    searchFiles(),
    applyPatchTool(),
    deleteFile(),
    execTool(),
    generateDailyReportTool(),
];

const toolMap = new Map<string, Tool>(tools.map((t) => [t.name, t]));

export function getTool(name: string): Tool | undefined {
    return toolMap.get(name) ?? getRuntimeSkillTool(name);
}

export function getToolSchemas(): ToolSchema[] {
    return [
        { name: "get_time", description: "返回当前服务器的日期与时间（本地时区）", parameters: { type: "object" } },
        {
            name: "echo",
            description: "回显传入的 text 参数（多用于联调）",
            parameters: { type: "object", properties: { text: { type: "string", description: "要回显的文本" } } },
        },
        {
            name: "json_validate",
            description: "校验 JSON 语法；pretty 为 true 时返回格式化后的文本",
            parameters: {
                type: "object",
                required: ["text"],
                properties: {
                    text: { type: "string", description: "待校验的 JSON 字符串" },
                    pretty: { type: "boolean", description: "为 true 时返回缩进后的 JSON" },
                },
            },
        },
        {
            name: "fetch_url",
            description:
                "HTTP GET 获取外部网页或公开 API 的文本；仅 http(s)。参数 max_chars 可选，限制返回正文长度",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: { type: "string", description: "完整 URL，如 https://developer.mozilla.org/zh-CN/docs/Web/API/fetch" },
                    max_chars: {
                        type: "number",
                        description: "正文最大字符数（可选，受服务器 ONECLAW_FETCH_MAX_RESPONSE_CHARS 上限约束）",
                    },
                },
            },
        },
        {
            name: "http_request",
            description:
                "HTTP 请求（GET/POST/PUT/PATCH/DELETE/HEAD），用于 REST/JSON API；body 或 body_json 用于写操作；headers 可选对象",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: { type: "string", description: "完整 https URL" },
                    method: {
                        type: "string",
                        description: "默认 GET；写操作常用 POST、PUT、PATCH、DELETE",
                    },
                    headers: { type: "object", description: "可选，键值均为字符串，如 Authorization、Content-Type" },
                    body: { type: "string", description: "原始请求体字符串（如 JSON 文本）" },
                    body_json: { type: "object", description: "将自动 JSON.stringify 并设 Content-Type: application/json（若未显式传 headers）" },
                    max_chars: { type: "number", description: "响应正文最大字符数（可选）" },
                },
            },
        },
        {
            name: "list_directory",
            description: "列出 workspace 目录下直接子项（不递归）；path 默认根目录",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "相对路径，如 apps/web；空或 . 表示主 workspace 根" },
                    max_entries: { type: "number", description: "最多返回条数，默认 200，上限 500" },
                },
            },
        },
        {
            name: "read_file",
            description:
                "读取允许范围内的文件。path 可为相对主 workspace 的路径，或在配置额外根时为允许范围内的绝对路径",
            parameters: {
                type: "object",
                required: ["path"],
                properties: {
                    path: { type: "string", description: "如 src/index.ts，或配置多根后的绝对路径" },
                },
            },
        },
        {
            name: "search_files",
            description: "在允许访问的根下搜索；多根时结果为绝对路径",
            parameters: {
                type: "object",
                properties: {
                    glob: { type: "string", description: "简单 glob，如 *.ts" },
                    content: { type: "string", description: "只返回内容包含该字符串的文件" },
                },
            },
        },
        {
            name: "apply_patch",
            description: "写入或追加文件；path 相对主 workspace 或允许根下绝对路径",
            parameters: {
                type: "object",
                required: ["path", "content"],
                properties: {
                    path: { type: "string", description: "相对路径或允许的绝对路径" },
                    content: { type: "string", description: "文件内容" },
                    mode: { type: "string", description: "replace 或 append" },
                },
            },
        },
        {
            name: "delete_file",
            description: "删除文件（需 file-access 中该路径为 full）。path 相对主 workspace 或允许的绝对路径",
            parameters: {
                type: "object",
                required: ["path"],
                properties: { path: { type: "string", description: "要删除的文件路径" } },
            },
        },
        {
            name: "exec",
            description: "在服务器上执行 shell 命令，有超时与输出长度限制",
            parameters: {
                type: "object",
                required: ["command"],
                properties: {
                    command: { type: "string", description: "要执行的命令，如 dir、dir /a" },
                    timeout_ms: { type: "number", description: "超时毫秒数（可选）" },
                    max_output_chars: { type: "number", description: "最大输出字符数（可选）" },
                },
            },
        },
        {
            name: "generate_daily_report",
            description:
                "根据工具调用日志生成日报并写入 workspace。可指定 date(YYYY-MM-DD)、sessionKey、agentId、outputPath",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "日期 YYYY-MM-DD，默认今天" },
                    sessionKey: { type: "string", description: "可选，按会话过滤" },
                    agentId: { type: "string", description: "可选，按 Agent 过滤" },
                    outputPath: { type: "string", description: "可选，相对 workspace，默认 reports/daily-YYYY-MM-DD.md" },
                },
            },
        },
    ];
}

/** 供 builtinProvider：风险与 Tool 定义同处维护 */
export function getBuiltinToolRiskLevel(name: string): ToolRiskLevel {
    return toolMap.get(name)?.riskLevel ?? "low";
}

export function getToolDescriptions(): string {
    return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}