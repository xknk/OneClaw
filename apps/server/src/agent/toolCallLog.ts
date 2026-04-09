/**
 * 工具调用审计日志模块
 * 用于记录 Agent 每次调用外部工具的详细情况，便于后续分析和调试
 */

import fs from "fs/promises";
import path from "path";
import { appConfig } from "@/config/evn";

/**
 * 单条日志行的结构定义
 */
export interface ToolCallLogLine {
    traceId: string;       // 调用追踪 ID，用于关联单次请求的所有行为
    sessionKey: string;    // 会话标识
    agentId: string;       // 执行任务的 Agent ID
    toolName: string;      // 调用的工具名称 (如 read_file)
    argsSummary: string;   // 经过脱敏和截断的入参摘要
    resultSummary: string; // 经过脱敏和截断的执行结果摘要
    ok: boolean;           // 是否执行成功
    durationMs: number;    // 耗时（毫秒）
    timestamp: string;     // ISO 格式的时间戳
    errorCode?: string;    // 错误码
}

/**
 * 获取日志文件路径，默认存放在配置目录下的 logs/tool-calls.jsonl
 * 使用 .jsonl (JSON Lines) 格式方便流式读取和追加
 */
function getLogFilePath(): string {
    return path.join(appConfig.dataDir, "logs", "tool-calls.jsonl");
}

/**
 * 安全的 JSON 序列化，防止循环引用导致崩溃
 */
function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * 核心：敏感信息脱敏 (Redaction)
 * 自动识别并屏蔽日志中的 Token、Password、API Key 等关键隐私数据
 */
function redact(text: string): string {
    // 匹配常见的密钥格式：key=xxx 或 "key":"xxx"
    return text
        .replace(
            /("?(token|password|secret|api[_-]?key)"?\s*[:=]\s*")([^"]+)(")/gi,
            (_m, p1, _k, _v, p4) => `${p1}[REDACTED]${p4}`
        )
        .replace(
            /((token|password|secret|api[_-]?key)\s*[:=]\s*)([^\s,]+)/gi,
            (_m, p1) => `${p1}[REDACTED]`
        );
}

/**
 * 摘要处理：合并“序列化”、“脱敏”与“长度限制”
 * 防止巨大的文件内容或 API 响应直接塞进日志导致磁盘写满
 */
function summarize(value: unknown, maxLen = 500): string {
    const raw = safeJson(value);
    const masked = redact(raw);
    // 如果长度超标，执行截断操作并添加后缀
    if (masked.length <= maxLen) return masked;
    return `${masked.slice(0, maxLen)}...(truncated)`;
}

/**
 * 工厂函数：将原始调用数据转换为标准化的日志行对象
 */
export function makeToolCallLog(input: {
    traceId: string; // 调用追踪 ID
    sessionKey: string; // 会话标识
    agentId: string; // 执行任务的 Agent ID
    toolName: string; // 调用的工具名称 (如 read_file)
    args: Record<string, unknown> | undefined; // 工具入参
    result: string; // 工具执行结果
    ok: boolean; // 是否执行成功
    durationMs: number; // 耗时（毫秒）
    errorCode?: string; // 错误码
}): ToolCallLogLine {
    const line: ToolCallLogLine = {
        traceId: input.traceId,
        sessionKey: input.sessionKey,
        agentId: input.agentId,
        toolName: input.toolName,
        argsSummary: summarize(input.args),
        resultSummary: summarize(input.result),
        ok: input.ok,
        durationMs: input.durationMs,
        timestamp: new Date().toISOString(),
    };
    if (input.errorCode !== undefined) {
        line.errorCode = input.errorCode;
    }
    return line;
}

/**
 * 异步追加日志到文件系统
 */
export async function appendToolCallLog(line: ToolCallLogLine): Promise<void> {
    const file = getLogFilePath();
    // 确保日志目录存在 (mkdir -p)
    await fs.mkdir(path.dirname(file), { recursive: true });
    // 追加 JSON 行，末尾补换行符
    await fs.appendFile(file, `${JSON.stringify(line)}\n`, "utf-8");
}
