import path from "path";
import os from "os";
import "dotenv/config";

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

export const ollamaConfig = {
    baseUrl: str("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    modelName: str("OLLAMA_MODEL_NAME", "qwen2.5:3b"),
    stream: bool("OLLAMA_STREAMING", false),
    temperature: num("OLLAMA_TEMPERATURE", 0.3),
    topP: num("OLLAMA_TOP_P", 0.9),
    topK: num("OLLAMA_TOP_K", 40),
    repeatPenalty: num("OLLAMA_REPEAT_PENALTY", 1.2),
    numPredict: num("OLLAMA_NUM_PREDICT", 512),
} as const;

export type OllamaConfig = typeof ollamaConfig;
const _DataDir = str("ONECLAW_DATA_DIR", path.join(os.homedir(), ".oneclaw"));
// 在文件末尾、ollamaConfig 导出之后增加：
export const appConfig = {
    dataDir: _DataDir,
    /** 发给模型的最大消息条数（只保留最近 N 条），避免超出 context 限制 */
    chatContextMaxMessages: num("ONECLAW_CHAT_CONTEXT_MAX_MESSAGES", 30),
    /** 超过此条数时对“更早部分”做总结，再与最近一段一起发给模型 */
    chatSummarizeThreshold: num("ONECLAW_CHAT_SUMMARIZE_THRESHOLD", 20),
    /** 工作目录路径：AI Agent 操作文件、读取技能（Skills）的根目录。 */
    // workspaceDir: str("ONECLAW_WORKSPACE_DIR", path.join(process.cwd(), "workspace")),
    /** 当前项目根目录路径 */
    projectRootDir: str("ONECLAW_PROJECT_ROOT_DIR", process.cwd()),
    /** 技能目录路径 */
    skillsDir: str(
        "ONECLAW_SKILLS_DIR",
        path.join(str("ONECLAW_PROJECT_ROOT_DIR", process.cwd()), "workspace")
    ),
    /** 用户工作目录路径 */
    userWorkspaceDir: str(
        "ONECLAW_USER_WORKSPACE_DIR",
        path.join(_DataDir, "workspace")
    ),
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
} as const;

export const PORT = num("PORT", 3000);