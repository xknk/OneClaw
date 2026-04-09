import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "@/config/evn"; // 引入全局配置，如工作目录路径
import type { TraceEvent } from "./traceTypes"; // 引入上一环节定义的追踪事件类型

/**
 * 生成基于当前日期的文件名
 * 格式示例: trace-2023-10-27.jsonl
 * 
 * @param date 可选日期对象，默认为当前时间
 * @returns 带有日期后缀的文件名字符串
 */
function todayFileName(date = new Date()): string {
    const y = date.getFullYear();
    // getMonth() 从 0 开始，所以需要 +1；padStart 确保月份和日期始终是两位数
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `trace-${y}-${m}-${d}.jsonl`;
}

/**
 * 获取追踪日志的存储目录路径
 * 
 * @returns 绝对路径字符串，例如: /workspace/logs/trace
 */
function traceDir(): string {
    // 基于应用配置的根目录，拼接出 logs/trace 子目录
    return path.join(appConfig.userWorkspaceDir, "logs", "trace");
}

/**
 * 将追踪事件追加到当天的日志文件中
 * 采用 JSONL 格式（每行一个 JSON 对象）
 * 
 * @param event 符合 TraceEvent 接口的事件对象
 */
export async function appendTraceEvent(event: TraceEvent): Promise<void> {
    const dir = traceDir();

    // 1. 确保目录存在
    // { recursive: true } 参数类似于 shell 中的 mkdir -p，会创建所有不存在的父目录
    await fs.mkdir(dir, { recursive: true });

    // 2. 序列化事件对象并添加换行符
    // 注意：JSONL 格式严禁在 JSON 内部包含换行符，JSON.stringify 默认满足此条件
    const line = JSON.stringify(event) + "\n";

    // 3. 拼接完整的文件路径
    const file = path.join(dir, todayFileName());

    // 4. 异步追加内容到文件末尾
    // 如果文件不存在，appendFile 会自动创建它
    await fs.appendFile(file, line, "utf-8");
}
