import fs from "fs/promises";
import path from "path";
import { appConfig } from "@/config/evn";
import { resolveInWorkspace } from "@/agent/tools/workspace";

/**
 * 原始日志行结构（对应日志文件中的每一行 JSON）
 */
interface RawToolCallLogLine {
    traceId: string;       // 请求追踪 ID
    sessionKey: string;    // 会话 Key (用户标识)
    agentId: string;       // Agent 标识
    toolName: string;      // 调用的工具名
    argsSummary: string;   // 参数摘要
    resultSummary: string; // 结果摘要
    ok: boolean;           // 是否调用成功
    durationMs: number;    // 耗时（毫秒）
    timestamp: string;     // ISO 时间戳
}

/** 输入参数配置 */
export interface DailyReportInput {
    date?: string;        // 报告日期 YYYY-MM-DD
    sessionKey?: string;  // 可选：仅统计某个用户的
    agentId?: string;     // 可选：仅统计某个 Agent 的
    outputPath?: string;  // 输出路径（相对于 workspace）
}

/** 报告输出结果元数据 */
export interface DailyReportOutput {
    date: string;
    outputPath: string;
    totalCalls: number;   // 总调用次数
    successCalls: number; // 成功次数
    failedCalls: number;  // 失败次数
    uniqueTools: number;  // 使用的不同工具种类数
}

/** 将 Date 对象转为本地 YYYY-MM-DD 字符串 */
function toYmdLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** 校验并解析日期，格式不正确或未传则返回今天 */
function resolveDate(input?: string): string {
    if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return input;
    }
    return toYmdLocal(new Date());
}

/** 获取日志文件存储的绝对路径 */
function getToolCallLogFile(): string {
    return path.join(appConfig.dataDir, "logs", "tool-calls.jsonl");
}

/** 从磁盘异步读取并解析所有的工具调用日志 */
async function readToolCallLogs(): Promise<RawToolCallLogLine[]> {
    const file = getToolCallLogFile();
    let text = "";
    try {
        text = await fs.readFile(file, "utf-8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return []; // 文件不存在返回空
        throw err;
    }

    // 过滤空行并逐行解析 JSON
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const parsed: RawToolCallLogLine[] = [];
    for (const line of lines) {
        try {
            const item = JSON.parse(line) as RawToolCallLogLine;
            if (item && item.timestamp && item.toolName) {
                parsed.push(item);
            }
        } catch { /* 忽略损坏的 JSON 行 */ }
    }
    return parsed;
}

/** 根据日期、Session、Agent 等条件过滤日志 */
function filterLogs(
    logs: RawToolCallLogLine[],
    params: { date: string; sessionKey?: string; agentId?: string }
): RawToolCallLogLine[] {
    return logs.filter((l) => {
        if (!l.timestamp.startsWith(params.date)) return false; // 日期前缀匹配
        if (params.sessionKey && l.sessionKey !== params.sessionKey) return false;
        if (params.agentId && l.agentId !== params.agentId) return false;
        return true;
    });
}

/** 核心逻辑：将日志数据渲染成 Markdown 文本 */
function renderMarkdown(
    date: string,
    logs: RawToolCallLogLine[],
    sessionKey?: string,
    agentId?: string
): string {
    const totalCalls = logs.length;
    const successCalls = logs.filter((l) => l.ok).length;
    const failedCalls = totalCalls - successCalls;

    // 统计工具使用频率
    const toolCountMap = new Map<string, number>();
    for (const l of logs) {
        toolCountMap.set(l.toolName, (toolCountMap.get(l.toolName) ?? 0) + 1);
    }

    const toolRows = [...toolCountMap.entries()]
        .sort((a, b) => b[1] - a[1]) // 按次数降序排列
        .map(([tool, count]) => `- ${tool}: ${count} 次`);

    // 构造详细的时间轴流水记录
    const timeline = logs
        .slice()
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)) // 时间升序
        .map((l) => {
            const time = l.timestamp.slice(11, 19); // 提取 HH:mm:ss
            const status = l.ok ? "OK" : "FAIL";
            return `- ${time} [${status}] ${l.toolName} (${l.durationMs}ms)\n  - args: ${l.argsSummary}\n  - result: ${l.resultSummary}`;
        });

    // 构造报告的头部信息
    const scope = [
        `- 日期: ${date}`,
        sessionKey ? `- sessionKey: ${sessionKey}` : null,
        agentId ? `- agentId: ${agentId}` : null,
    ].filter(Boolean);

    const summaryText = totalCalls === 0
        ? "今天没有记录到工具调用。"
        : `今日共调用 ${totalCalls} 次工具，成功 ${successCalls} 次，失败 ${failedCalls} 次。`;

    // 根据成功率给出自动化建议
    const suggestions = failedCalls > 0
        ? ["- 检查失败调用对应的参数与权限策略。", "- 对失败高频工具补充更清晰的调用提示。"]
        : ["- 今日工具调用整体稳定，可继续沉淀自动化流程。", "- 可考虑把高频操作封装成专用 Skill。"];

    return [
        `# Daily Report - ${date}`,
        "",
        "## 范围",
        ...scope,
        "",
        "## 今日概览",
        `- ${summaryText}`,
        `- 使用工具种类: ${toolCountMap.size}`,
        "",
        "## 工具调用统计",
        ...(toolRows.length ? toolRows : ["- 无"]),
        "",
        "## 时间线",
        ...(timeline.length ? timeline : ["- 无"]),
        "",
        "## 风险与建议",
        ...suggestions,
        "",
    ].join("\n");
}

/** 
 * 导出函数：生成日报主流程
 */
export async function generateDailyReport(
    input: DailyReportInput
): Promise<DailyReportOutput> {
    const date = resolveDate(input.date);

    // 1. 获取并过滤数据
    const logs = await readToolCallLogs();
    const filtered = filterLogs(logs, {
        date,
        sessionKey: input.sessionKey,
        agentId: input.agentId,
    });

    // 2. 确定输出路径
    const outputPath = input.outputPath?.trim() || `reports/daily-${date}.md`;
    const absPath = resolveInWorkspace(outputPath, "write");

    // 3. 渲染 Markdown 并写入文件
    const markdown = renderMarkdown(date, filtered, input.sessionKey, input.agentId);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, markdown, "utf-8");

    // 4. 返回统计元数据
    return {
        date,
        outputPath,
        totalCalls: filtered.length,
        successCalls: filtered.filter((l) => l.ok).length,
        failedCalls: filtered.length - filtered.filter((l) => l.ok).length,
        uniqueTools: new Set(filtered.map((l) => l.toolName)).size,
    };
}
