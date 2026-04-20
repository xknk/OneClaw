import path from "path";
import os from "os";
import fs from "fs";
import dotenv from "dotenv";

/**
 * 自当前工作目录向上查找含 pnpm-workspace.yaml 的目录，作为 monorepo 根（用于默认 projectRoot 与 .env）。
 */
function findWorkspaceRoot(start: string): string {
    let dir = path.resolve(start);
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return path.resolve(start);
}

const _workspaceRoot = findWorkspaceRoot(process.cwd());
if (fs.existsSync(path.join(_workspaceRoot, ".env"))) {
    dotenv.config({ path: path.join(_workspaceRoot, ".env") });
}
dotenv.config({ path: path.join(process.cwd(), ".env"), override: true });

/**
 * 配置层：从 .env 读取并做类型转换与默认值，供业务使用。
 * 应用入口需先执行 dotenv.config()（或 import "dotenv/config"），再使用本模块。
 */
function str(key: string, defaultValue: string): string {
    const v = process.env[key];
    return v !== undefined && v !== "" ? String(v).trim() : defaultValue;
}

function num(key: string, defaultValue: number): number {
    const v = process.env[key];
    if (v === undefined || v === "") return defaultValue;
    const n = Number(v);
    return Number.isFinite(n) ? n : defaultValue;
}

function bool(key: string, defaultValue: boolean): boolean {
    const v = process.env[key];
    if (v === undefined || v === "") return defaultValue;
    const lower = String(v).trim().toLowerCase();
    return lower === "1" || lower === "true" || lower === "yes";
}

/** UI 语言：TUI、Web 默认语言、上下文摘要提示等 */
export type UiLocale = "zh" | "en";

function uiLocale(key: string, defaultValue: UiLocale): UiLocale {
    const v = process.env[key];
    if (v === undefined || v === "") return defaultValue;
    const lower = String(v).trim().toLowerCase();
    if (lower === "en" || lower === "en-us" || lower === "english") return "en";
    if (lower === "zh" || lower === "zh-cn" || lower === "zh-hans" || lower === "chinese") return "zh";
    return defaultValue;
}

export const ollamaConfig = {
    baseUrl: str("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    modelName: str("OLLAMA_MODEL_NAME", "qwen2.5:3b"),
    stream: bool("OLLAMA_STREAMING", false),
    temperature: num("OLLAMA_TEMPERATURE", 0.3),
    topP: num("OLLAMA_TOP_P", 0.9),
    topK: num("OLLAMA_TOP_K", 40),
    repeatPenalty: num("OLLAMA_REPEAT_PENALTY", 1.2),
    numPredict: num("OLLAMA_NUM_PREDICT", 512),
    /** 连接与生成的整体超时（毫秒），超时会 abort fetch 并报错 */
    timeout: num("OLLAMA_CONNECT_TIMEOUT", 120000),
} as const;
export type OllamaConfig = typeof ollamaConfig;

export const zhipuConfig = {
    modelName: str("ZHIPU_MODEL_NAME", ""),
    baseUrl: str("ZHIPU_BASE_URL", ""),
    apiKey: str("ZHIPU_API_KEY", ""),
    stream: bool("ZHIPU_STREAMING", false),
    temperature: num("ZHIPU_TEMPERATURE", 0.6),
    topP: num("ZHIPU_TOP_P", 0.95),
    thinking: { enable: bool("ZHIPU_THINKING_ENABLE", false) },
    timeout: num("ZHIPU_CONNECT_TIMEOUT", 120000),
} as const;
export type ZhipuConfig = typeof zhipuConfig;

const _DataDir = str("ONECLAW_DATA_DIR", path.join(os.homedir(), ".oneclaw"));
const _userWorkspaceDirStr = str("ONECLAW_USER_WORKSPACE_DIR", path.join(_DataDir, "workspace"));
export const appConfig = {
    dataDir: _DataDir,
    /** 发给模型的最大消息条数（只保留最近 N 条），避免超出 context 限制 */
    chatContextMaxMessages: num("ONECLAW_CHAT_CONTEXT_MAX_MESSAGES", 30),
    /** 对话历史（滚动摘要 + 原文尾）允许的最大估算 token；不含技能/任务等 prefix */
    chatHistoryMaxTokens: num("ONECLAW_CHAT_HISTORY_MAX_TOKENS", 6000),
    /** 对话历史（滚动摘要 + 原文尾）保留最近 N 条消息，避免语音丢失 */
    chatContextReserveMessages: num("ONECLAW_CHAT_CONTEXT_RESERVE_MESSAGES", 8),
    /** 单条消息超过此估算 token 时在条内从尾部截断 */
    chatSingleMessageMaxTokens: num("ONECLAW_CHAT_SINGLE_MESSAGE_MAX_TOKENS", 4000),
    /** @deprecated 已由 token 预算 + 滚动摘要替代；保留读取以兼容旧 .env */
    chatSummarizeThreshold: num("ONECLAW_CHAT_SUMMARIZE_THRESHOLD", 20),
    /** 工作目录路径：AI Agent 操作文件、读取技能（Skills）的根目录。 */
    // workspaceDir: str("ONECLAW_WORKSPACE_DIR", path.join(process.cwd(), "workspace")),
    /** 当前项目根目录路径（monorepo 下默认指向仓库根，而非 apps/server） */
    projectRootDir: str("ONECLAW_PROJECT_ROOT_DIR", _workspaceRoot),
    /** 技能目录路径 */
    skillsDir: str(
        "ONECLAW_SKILLS_DIR",
        path.join(str("ONECLAW_PROJECT_ROOT_DIR", _workspaceRoot), "workspace")
    ),
    /** 用户工作目录路径（主 workspace；相对路径工具参数仍以此为基准） */
    userWorkspaceDir: _userWorkspaceDirStr,
    /** exec 工具：超时（毫秒） */
    execTimeoutMs: num("ONECLAW_EXEC_TIMEOUT_MS", 30_000),
    /** exec 工具：stdout+stderr 最大字符数 */
    execMaxOutputChars: num("ONECLAW_EXEC_MAX_OUTPUT_CHARS", 10_000),
    /** WebChat 访问 token，非空时请求需带 Authorization: Bearer <token> 或 query token= */
    webchatToken: str("WEBCHAT_TOKEN", ""),
    /** 服务绑定地址，默认 127.0.0.1 仅本机；设为 0.0.0.0 可允许局域网访问 */
    bindHost: str("BIND_HOST", "127.0.0.1"),
    /** exec 工具是否启用（doctor 会检查此项） */
    execEnabled: bool("ONECLAW_EXEC_ENABLED", true),
    /** exec 禁止的命令模式（逗号分隔正则），命中则不执行 */
    execDeniedPatterns: str("ONECLAW_EXEC_DENIED_PATTERNS", "rm\\s+-rf\\s+/|format\\s+[a-z]|del\\s+/f\\s+/s|mkfs\\.|:(){:|:&};:"),
    /** QQ 渠道是否启用（Phase 3） */
    qqBotEnabled: bool("ONECLAW_QQ_BOT_ENABLED", false),
    /** OneBot 兼容实现的 API 地址（如 go-cqhttp 的 http://127.0.0.1:5700），用于发送回复 */
    qqBotApiBaseUrl: str("ONECLAW_QQ_BOT_API_BASE_URL", ""),
    /** QQ 机器人 token（若 OneBot 实现需要鉴权则填写；webhook 校验也可用） */
    qqBotToken: str("ONECLAW_QQ_BOT_TOKEN", ""),
    /** 定时日报：Gateway 内按本地时钟每天触发一次（默认关闭） */
    dailyReportScheduleEnabled: bool("ONECLAW_DAILY_REPORT_SCHEDULE_ENABLED", false),
    /** 本地小时 0–23，默认 18 */
    dailyReportScheduleHour: Math.min(23, Math.max(0, num("ONECLAW_DAILY_REPORT_SCHEDULE_HOUR", 18))),
    /** 本地分钟 0–59，默认 0 */
    dailyReportScheduleMinute: Math.min(59, Math.max(0, num("ONECLAW_DAILY_REPORT_SCHEDULE_MINUTE", 0))),
    /** V4 M3：带 taskId 的任务是否对 exec/apply_patch 强制待审批 */
    taskHighRiskApprovalEnabled: bool("ONECLAW_TASK_HIGH_RISK_APPROVAL", true),
    /**
 * MCP：单次 listTools（含 connect）最大等待毫秒；超时视为该 MCP 不可用，上层跳过工具列表。
 */
    mcpListToolsTimeoutMs: num("ONECLAW_MCP_LIST_TOOLS_TIMEOUT_MS", 10_000),
    /** 内置 fetch_url 是否启用 */
    fetchUrlEnabled: bool("ONECLAW_FETCH_URL_ENABLED", true),
    /** fetch_url 单请求超时（毫秒） */
    fetchTimeoutMs: num("ONECLAW_FETCH_TIMEOUT_MS", 30_000),
    /** fetch_url 响应正文最大字符数（硬上限） */
    fetchMaxResponseChars: num("ONECLAW_FETCH_MAX_RESPONSE_CHARS", 400_000),
    /** 为 true 时允许访问内网/本机地址（仅建议本机开发） */
    fetchAllowPrivateHosts: bool("ONECLAW_FETCH_ALLOW_PRIVATE_HOSTS", false),
    /** V4 M2：是否启用步骤工具白名单强制执行 */
    m2StepToolEnforcement: bool("ONECLAW_M2_STEP_TOOL_ENFORCEMENT", true),
    /** 界面语言（TUI、Web 服务端默认值、摘要提示语等） */
    uiLocale: uiLocale("ONECLAW_UI_LOCALE", "zh"),
    /** 单个 trace JSONL 超过此字节数则轮转为同日 `trace-YYYY-MM-DD-partN.jsonl` */
    traceFileMaxBytes: num("ONECLAW_TRACE_FILE_MAX_BYTES", 64 * 1024 * 1024),
    /** 保留最近 N 个日历日的 trace 文件，更早的会被异步清理 */
    traceRetentionDays: num("ONECLAW_TRACE_RETENTION_DAYS", 30),
    /**
     * 滚动摘要：单次 token 超限时，一次合并进摘要的最多消息条数（减少串行 LLM 调用次数）。
     */
    chatRollingMergeChunk: num("ONECLAW_CHAT_ROLLING_MERGE_CHUNK", 15),
    /**
     * 助手回复写入后是否在后台预跑滚动摘要（与 buildMessagesForModel 对齐），以降低下一轮首包前同步摘要耗时。
     */
    chatRollingPrefetchEnabled: bool("ONECLAW_ROLLING_PREFETCH_ENABLED", true),

} as const;

export const PORT = num("PORT", 3000);