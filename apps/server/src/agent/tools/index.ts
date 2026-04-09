/**
 * 内置工具注册表：管理 AI 可以调用的所有外部函数
 */

import type { Tool } from "../types";
import type { ToolSchema } from "../../llm/providers/ModelProvider";
import { readFileInWorkspace, searchInWorkspace } from "./workspace";
import { applyPatch } from "./applyPatch";
import { controlledExec } from "./controlledExec";
import { appConfig } from "../../config/evn";
import { generateDailyReportTool } from "./generateDailyReport";
import { getRuntimeSkillTool } from "@/skills/toolImplRegistry";

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
        description: "回显传入的 text 参数，用于测试工具调用",
        async execute(args) {
            const text = args?.text;
            return typeof text === "string" ? text : String(JSON.stringify(args ?? {}));
        },
    };
}

function readFile(): Tool {
    return {
        name: "read_file",
        description: "读取 workspace 内文件内容。path 为相对 workspace 根的路径，如 src/index.ts",
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
        description: "在 workspace 内搜索文件。glob 可选，如 *.ts；content 可选，只返回内容包含该字符串的文件路径",
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

function applyPatchTool(): Tool {
    return {
        name: "apply_patch",
        description: "在 workspace 内写入或追加文件（默认仅允许 workspace 内）。path 为相对路径，content 为内容，mode 可选 replace|append",
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
        description: "在服务器上执行一条 shell 命令，有超时和输出长度限制。command 为要执行的命令字符串（如 dir、dir /a）",
        async execute(args) {
            const command = args?.command;
            if (!appConfig.execEnabled) {
                return "exec 工具已通过 ONECLAW_EXEC_ENABLED 关闭";
            }
            if (typeof command !== "string") return "缺少参数 command（要执行的命令）";
            const timeoutMs = typeof args?.timeout_ms === "number" ? args.timeout_ms : appConfig.execTimeoutMs;
            const maxChars = typeof args?.max_output_chars === "number" ? args.max_output_chars : appConfig.execMaxOutputChars;
            const result = await controlledExec(command, [], { timeoutMs, maxOutputChars: maxChars });
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
    readFile(),
    searchFiles(),
    applyPatchTool(),
    execTool(),
    generateDailyReportTool(),
];

const toolMap = new Map<string, Tool>(tools.map((t) => [t.name, t]));

export function getTool(name: string): Tool | undefined {
    return toolMap.get(name) ?? getRuntimeSkillTool(name);
}

export function getAllTools(): Tool[] {
    return tools;
}

export function getToolSchemas(): ToolSchema[] {
    return [
        { name: "get_time", description: "返回当前服务器的日期与时间（本地时区）", parameters: { type: "object" } },
        {
            name: "echo",
            description: "回显传入的 text 参数，用于测试工具调用",
            parameters: { type: "object", properties: { text: { type: "string", description: "要回显的文本" } } },
        },
        {
            name: "read_file",
            description: "读取 workspace 内文件内容。path 为相对 workspace 根的路径",
            parameters: {
                type: "object",
                required: ["path"],
                properties: { path: { type: "string", description: "相对路径，如 src/index.ts" } },
            },
        },
        {
            name: "search_files",
            description: "在 workspace 内搜索文件。glob 可选如 *.ts，content 可选为内容子串",
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
            description: "在 workspace 内写入或追加文件。path 相对路径，content 内容，mode 可选 replace|append",
            parameters: {
                type: "object",
                required: ["path", "content"],
                properties: {
                    path: { type: "string", description: "相对 workspace 的路径" },
                    content: { type: "string", description: "文件内容" },
                    mode: { type: "string", description: "replace 或 append" },
                },
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

export function getToolDescriptions(): string {
    return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}