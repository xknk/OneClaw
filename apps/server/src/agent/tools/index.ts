/**
 * 内置工具注册表：管理 AI 可以调用的所有外部函数
 */

import type { Tool } from "../types";
import type { ToolSchema } from "../../llm/providers/ModelProvider";
import type { ToolExecutionContext, ToolRiskLevel } from "../../tools/types";
import {
    batchFileOperationsInWorkspace,
    copyPathInWorkspace,
    deleteFileInWorkspace,
    listDirInWorkspace,
    makeDirectoryInWorkspace,
    movePathInWorkspace,
    readFileInWorkspace,
    readFileRangeInWorkspace,
    hashFileInWorkspace,
    searchInWorkspace,
    statPathInWorkspace,
} from "./workspace";
import { executeWebSearch } from "./webSearch";
import { executeFetchReadable } from "./fetchReadable";
import { executeFetchFeed } from "./fetchFeed";
import { executeDnsResolve } from "./dnsResolve";
import { createZipInWorkspace, extractZipInWorkspace } from "./zipWorkspace";
import { runGitRead, runGitWrite } from "./gitWorkspace";
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
            "HTTP GET 拉取**公网**网页/API（仅 http/https）。**勿**用于本地盘符或 file://；本地目录用 list_directory，本地文件用 read_file。内网默认禁止，可用 ONECLAW_FETCH_ALLOW_PRIVATE_HOSTS 放开",
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
            "HTTP 请求用于**网络** REST/JSON API（url 须 http(s)）。勿用于 D:\\\\ 等本地路径；本地用 list_directory/read_file/exec。与 fetch_url 共用 ONECLAW_FETCH_*；勿泄露密钥",
        async execute(args) {
            return executeHttpRequest(args ?? {});
        },
    };
}

function listDirectoryTool(): Tool {
    return {
        name: "list_directory",
        description:
            "列出**本地**目录直接子项（不递归）；path 可为相对 workspace 或 file-access 允许的绝对路径。查看文件夹内容用本工具或 exec 的 dir，**勿用 fetch_url**",
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

function readFileRangeTool(): Tool {
    return {
        name: "read_file_range",
        riskLevel: "low",
        description:
            "按行读取大文件片段，避免整文件撑爆上下文。line_start 从 1 起；可选 line_end（含）。不传 line_end 时最多约 8000 行",
        async execute(args) {
            const p = args?.path;
            const ls = args?.line_start;
            const le = args?.line_end;
            if (typeof p !== "string" || !p.trim()) return "缺少参数 path";
            if (typeof ls !== "number" || !Number.isFinite(ls)) return "缺少参数 line_start（数字）";
            try {
                return await readFileRangeInWorkspace(
                    p.trim(),
                    ls,
                    typeof le === "number" && Number.isFinite(le) ? le : undefined,
                );
            } catch (e) {
                return `分段读取失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function fileHashTool(): Tool {
    return {
        name: "file_hash",
        riskLevel: "low",
        description: "计算文件 SHA256 或 MD5（整文件读取）。algorithm 默认 sha256",
        async execute(args) {
            const p = args?.path;
            const algo = args?.algorithm === "md5" ? "md5" : "sha256";
            if (typeof p !== "string" || !p.trim()) return "缺少参数 path";
            try {
                return await hashFileInWorkspace(p.trim(), algo);
            } catch (e) {
                return `哈希失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function webSearchTool(): Tool {
    return {
        name: "web_search",
        riskLevel: "medium",
        description:
            "公网网页搜索（Brave Search API）。需在 .env 配置 ONECLAW_BRAVE_API_KEY 或 BRAVE_API_KEY。query 为关键词，count 可选 1–20",
        async execute(args) {
            return executeWebSearch(args ?? {});
        },
    };
}

function fetchReadableTool(): Tool {
    return {
        name: "fetch_readable",
        riskLevel: "medium",
        description:
            "HTTP GET 网页并粗提正文为纯文本（去 script/style/标签）。规则与 fetch_url 相同；适合长文阅读",
        async execute(args) {
            return executeFetchReadable(args ?? {});
        },
    };
}

function fetchFeedTool(): Tool {
    return {
        name: "fetch_feed",
        riskLevel: "medium",
        description: "拉取 RSS/Atom feed URL，解析若干条标题与链接（启发式解析）",
        async execute(args) {
            return executeFetchFeed(args ?? {});
        },
    };
}

function dnsResolveTool(): Tool {
    return {
        name: "dns_resolve",
        riskLevel: "low",
        description: "DNS 查询：hostname + record_type（A|AAAA|TXT|MX|CNAME，默认 A）",
        async execute(args) {
            return executeDnsResolve(args ?? {});
        },
    };
}

function createZipTool(): Tool {
    return {
        name: "create_zip",
        riskLevel: "high",
        description:
            "将多个文件或目录打成 zip。paths 为路径数组，output_path 为生成的 .zip 路径（须在 file-access 允许范围内）",
        async execute(args) {
            const paths = args?.paths;
            const out = args?.output_path;
            if (!Array.isArray(paths) || !paths.every((x) => typeof x === "string")) {
                return "缺少参数 paths（字符串数组）";
            }
            if (typeof out !== "string" || !out.trim()) return "缺少参数 output_path";
            try {
                return await createZipInWorkspace(paths as string[], out.trim());
            } catch (e) {
                return `打包失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function extractZipTool(): Tool {
    return {
        name: "extract_zip",
        riskLevel: "high",
        description: "解压 zip 到目标目录（覆盖同名文件）。zip_path 与 target_dir 均为允许路径",
        async execute(args) {
            const zipPath = args?.zip_path;
            const targetDir = args?.target_dir;
            if (typeof zipPath !== "string" || !zipPath.trim()) return "缺少参数 zip_path";
            if (typeof targetDir !== "string" || !targetDir.trim()) return "缺少参数 target_dir";
            try {
                return await extractZipInWorkspace(zipPath.trim(), targetDir.trim());
            } catch (e) {
                return `解压失败: ${e instanceof Error ? e.message : String(e)}`;
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

function moveFileTool(): Tool {
    return {
        name: "move_file",
        riskLevel: "high",
        description:
            "移动或重命名允许范围内的文件或目录（同卷 rename）。from/to 为相对 workspace 或允许的绝对路径；跨卷请用 copy_file 再 delete_file",
        async execute(args) {
            const from = args?.from;
            const to = args?.to;
            if (typeof from !== "string" || !from.trim()) return "缺少参数 from（字符串路径）";
            if (typeof to !== "string" || !to.trim()) return "缺少参数 to（字符串路径）";
            try {
                return await movePathInWorkspace(from.trim(), to.trim());
            } catch (e) {
                return `移动失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function copyFileTool(): Tool {
    return {
        name: "copy_file",
        riskLevel: "high",
        description:
            "复制文件；复制目录时须设 recursive=true。路径规则同 apply_patch / delete_file",
        async execute(args) {
            const from = args?.from;
            const to = args?.to;
            const recursive = args?.recursive === true;
            if (typeof from !== "string" || !from.trim()) return "缺少参数 from（字符串路径）";
            if (typeof to !== "string" || !to.trim()) return "缺少参数 to（字符串路径）";
            try {
                return await copyPathInWorkspace(from.trim(), to.trim(), recursive);
            } catch (e) {
                return `复制失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function makeDirectoryTool(): Tool {
    return {
        name: "make_directory",
        riskLevel: "high",
        description:
            "创建目录；默认 recursive=true（父级不存在时一并创建）。需 write 级 file-access",
        async execute(args) {
            const p = args?.path;
            const recursive = args?.recursive !== false;
            if (typeof p !== "string" || !p.trim()) return "缺少参数 path（字符串路径）";
            try {
                return await makeDirectoryInWorkspace(p.trim(), recursive);
            } catch (e) {
                return `创建目录失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function fileStatTool(): Tool {
    return {
        name: "file_stat",
        riskLevel: "low",
        description:
            "查询文件或目录元数据（大小、mtime、mode 等），不读文件内容。path 规则同 read_file",
        async execute(args) {
            const p = args?.path;
            if (typeof p !== "string" || !p.trim()) return "缺少参数 path（字符串路径）";
            try {
                return await statPathInWorkspace(p.trim());
            } catch (e) {
                return `stat 失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function batchFileOpsTool(): Tool {
    return {
        name: "batch_file_ops",
        riskLevel: "high",
        description:
            "批量顺序执行 delete / move / copy / mkdir（最多 30 条），任一步失败则中止。每项为 { op, path?, from?, to?, recursive? }",
        async execute(args) {
            const ops = args?.operations;
            if (!Array.isArray(ops)) return "缺少参数 operations（对象数组）";
            try {
                return await batchFileOperationsInWorkspace(ops as Parameters<typeof batchFileOperationsInWorkspace>[0]);
            } catch (e) {
                return `批量操作失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function gitReadTool(): Tool {
    return {
        name: "git_read",
        riskLevel: "medium",
        description:
            "在允许的 working_directory 下执行**只读** git 子命令（status/diff/log/branch 等），不走 shell。args 为传给 git 的 argv 数组，如 [\"status\",\"--porcelain\"]",
        async execute(args) {
            const wd = typeof args?.working_directory === "string" ? args.working_directory : ".";
            const argv = args?.args;
            if (!Array.isArray(argv) || !argv.every((x) => typeof x === "string")) {
                return "需要参数 args：字符串数组（git 子命令及选项）";
            }
            try {
                return await runGitRead(wd, argv as string[]);
            } catch (e) {
                return `git_read 失败: ${e instanceof Error ? e.message : String(e)}`;
            }
        },
    };
}

function gitWriteTool(): Tool {
    return {
        name: "git_write",
        riskLevel: "high",
        description:
            "在允许的 working_directory 下执行**写入类** git（add/commit/push/pull/checkout 等），高危需审批。args 为 argv 数组",
        async execute(args) {
            const wd = typeof args?.working_directory === "string" ? args.working_directory : ".";
            const argv = args?.args;
            if (!Array.isArray(argv) || !argv.every((x) => typeof x === "string")) {
                return "需要参数 args：字符串数组（git 子命令及选项）";
            }
            try {
                return await runGitWrite(wd, argv as string[]);
            } catch (e) {
                return `git_write 失败: ${e instanceof Error ? e.message : String(e)}`;
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
    fetchReadableTool(),
    fetchFeedTool(),
    httpRequestTool(),
    webSearchTool(),
    dnsResolveTool(),
    listDirectoryTool(),
    readFile(),
    readFileRangeTool(),
    fileHashTool(),
    searchFiles(),
    fileStatTool(),
    applyPatchTool(),
    deleteFile(),
    moveFileTool(),
    copyFileTool(),
    makeDirectoryTool(),
    createZipTool(),
    extractZipTool(),
    batchFileOpsTool(),
    gitReadTool(),
    gitWriteTool(),
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
                "HTTP GET 拉取**公网**网页或公开 API 的文本；**仅**支持 http(s) 完整 URL。**禁止**把本地路径当作 url（如 D:\\\\目录、C:\\\\foo、file://）；浏览本地文件夹用 list_directory，读本地文件用 read_file，或用 exec 跑 dir/type 等。参数 max_chars 可选",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: {
                        type: "string",
                        description: "必须以 http:// 或 https:// 开头；勿传盘符路径或 file://",
                    },
                    max_chars: {
                        type: "number",
                        description: "正文最大字符数（可选，受服务器 ONECLAW_FETCH_MAX_RESPONSE_CHARS 上限约束）",
                    },
                },
            },
        },
        {
            name: "fetch_readable",
            description: "GET 网页并提取为纯文本，规则同 fetch_url",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: { type: "string", description: "http(s) URL" },
                    max_chars: { type: "number", description: "最大字符数（可选）" },
                },
            },
        },
        {
            name: "fetch_feed",
            description: "拉取 RSS/Atom feed，解析条目标题与链接",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: { type: "string", description: "feed 的 http(s) URL" },
                    max_items: { type: "number", description: "最多条数，默认 15，上限 50" },
                },
            },
        },
        {
            name: "http_request",
            description:
                "HTTP 请求（GET/POST/PUT/PATCH/DELETE/HEAD），用于 **REST/JSON 等网络 API**；url 须为 http(s)。**禁止**用本工具访问本地盘符路径；本地目录/文件请用 list_directory、read_file 或 exec",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: { type: "string", description: "https:// 或 http:// 完整 URL，勿传 D:\\\\ 等本地路径" },
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
            name: "web_search",
            description: "Brave 网页搜索；需配置 ONECLAW_BRAVE_API_KEY 或 BRAVE_API_KEY",
            parameters: {
                type: "object",
                required: ["query"],
                properties: {
                    query: { type: "string", description: "搜索关键词" },
                    count: { type: "number", description: "结果条数 1–20，默认 8" },
                },
            },
        },
        {
            name: "dns_resolve",
            description: "DNS 查询（A/AAAA/TXT/MX/CNAME）",
            parameters: {
                type: "object",
                required: ["hostname"],
                properties: {
                    hostname: { type: "string", description: "域名" },
                    record_type: { type: "string", description: "A | AAAA | TXT | MX | CNAME，默认 A" },
                },
            },
        },
        {
            name: "list_directory",
            description:
                "列出**本地**目录的直接子项（不递归）。path 可为相对主 workspace，或在 file-access 允许的**绝对路径**（如已配置 D:\\\\ 额外根）。检查「某文件夹里有哪些文件」必须用本工具或 exec 的 dir，**不要用 fetch_url**",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "如 apps/web；或允许的绝对路径如 D:\\\\打印文件；空或 . 表示主 workspace 根",
                    },
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
            name: "read_file_range",
            description: "按行读取文件片段；line_start 从 1 起，line_end 可选",
            parameters: {
                type: "object",
                required: ["path", "line_start"],
                properties: {
                    path: { type: "string", description: "文件路径" },
                    line_start: { type: "number", description: "起始行（含）" },
                    line_end: { type: "number", description: "结束行（含），可选" },
                },
            },
        },
        {
            name: "file_hash",
            description: "计算文件 SHA256 或 MD5",
            parameters: {
                type: "object",
                required: ["path"],
                properties: {
                    path: { type: "string", description: "文件路径" },
                    algorithm: { type: "string", description: "sha256 或 md5，默认 sha256" },
                },
            },
        },
        {
            name: "file_stat",
            description: "查询路径元数据（大小、mtime、权限位），不读取文件内容",
            parameters: {
                type: "object",
                required: ["path"],
                properties: {
                    path: { type: "string", description: "相对 workspace 或允许的绝对路径" },
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
            name: "move_file",
            description: "移动或重命名文件/目录（同卷）；from、to 为路径",
            parameters: {
                type: "object",
                required: ["from", "to"],
                properties: {
                    from: { type: "string", description: "源路径" },
                    to: { type: "string", description: "目标路径" },
                },
            },
        },
        {
            name: "copy_file",
            description: "复制文件或目录（目录需 recursive=true）",
            parameters: {
                type: "object",
                required: ["from", "to"],
                properties: {
                    from: { type: "string", description: "源路径" },
                    to: { type: "string", description: "目标路径" },
                    recursive: { type: "boolean", description: "目录复制时为 true" },
                },
            },
        },
        {
            name: "make_directory",
            description: "创建目录，默认 recursive=true",
            parameters: {
                type: "object",
                required: ["path"],
                properties: {
                    path: { type: "string", description: "目录路径" },
                    recursive: { type: "boolean", description: "是否创建父级，默认 true" },
                },
            },
        },
        {
            name: "create_zip",
            description: "将多个路径打包为 zip 文件",
            parameters: {
                type: "object",
                required: ["paths", "output_path"],
                properties: {
                    paths: {
                        type: "array",
                        items: { type: "string" },
                        description: "文件或目录路径列表",
                    },
                    output_path: { type: "string", description: "输出的 .zip 路径" },
                },
            },
        },
        {
            name: "extract_zip",
            description: "解压 zip 到目标目录",
            parameters: {
                type: "object",
                required: ["zip_path", "target_dir"],
                properties: {
                    zip_path: { type: "string", description: "zip 文件路径" },
                    target_dir: { type: "string", description: "解压目标目录" },
                },
            },
        },
        {
            name: "batch_file_ops",
            description: "批量 delete/move/copy/mkdir，operations 为数组，每项含 op 字段",
            parameters: {
                type: "object",
                required: ["operations"],
                properties: {
                    operations: {
                        type: "array",
                        description: "如 [{ op: \"delete\", path: \"a.txt\" }, { op: \"mkdir\", path: \"sub\" }]",
                        items: { type: "object" },
                    },
                },
            },
        },
        {
            name: "git_read",
            description: "只读 git；working_directory 为仓库目录，args 为 [子命令, ...]",
            parameters: {
                type: "object",
                required: ["args"],
                properties: {
                    working_directory: {
                        type: "string",
                        description: "相对 workspace 或允许的绝对路径，默认 .",
                    },
                    args: {
                        type: "array",
                        items: { type: "string" },
                        description: '例如 ["status","--porcelain"]',
                    },
                },
            },
        },
        {
            name: "git_write",
            description: "写入类 git（add/commit/push 等），参数同 git_read",
            parameters: {
                type: "object",
                required: ["args"],
                properties: {
                    working_directory: {
                        type: "string",
                        description: "仓库根目录或子目录（须在允许路径内）",
                    },
                    args: { type: "array", items: { type: "string" }, description: '例如 ["add","."]' },
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

/** 供 builtinProvider：风险与 Tool 定义同处维护 */
export function getBuiltinToolRiskLevel(name: string): ToolRiskLevel {
    return toolMap.get(name)?.riskLevel ?? "low";
}

export function getToolDescriptions(): string {
    return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}