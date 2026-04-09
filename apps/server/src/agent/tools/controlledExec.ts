/**
 * 受控执行 shell 命令：超时、最大输出长度、安全终止
 */

import { spawn } from "child_process";
import { appConfig } from "../../config/evn"; // 引入全局配置，如默认超时时间

// 定义执行结果的接口
export interface ExecResult {
    stdout: string;    // 标准输出内容
    stderr: string;    // 标准错误内容
    exitCode: number | null; // 退出码（0通常表示成功）
    timedOut: boolean;  // 是否因为超时被强制停止
    truncated: boolean; // 输出内容是否因为过长被截断
}

/**
 * 异步执行指定的 shell 命令并监控其行为
 * @param command 命令程序（如 'node'）
 * @param args 参数列表（如 ['app.js']）
 * @param options 可选配置：超时时间(ms)和最大字符数
 */
export async function controlledExec(
    command: string,
    args: string[] = [],
    options?: { timeoutMs?: number; maxOutputChars?: number }
): Promise<ExecResult> {
    // 优先级：用户传入配置 > 全局 appConfig 配置
    const timeoutMs = options?.timeoutMs ?? appConfig.execTimeoutMs;
    const maxChars = options?.maxOutputChars ?? appConfig.execMaxOutputChars;
    const rawPatterns = appConfig.execDeniedPatterns;
    if (rawPatterns) {
        const patterns = rawPatterns.split(",").map((p) => p.trim()).filter(Boolean);
        const normalized = command.trim();
        for (const p of patterns) {
            try {
                if (new RegExp(p, "i").test(normalized)) {
                    return Promise.reject(new Error(`该命令被策略拒绝: 命中禁止规则`));
                }
            } catch {
                // 无效正则忽略
            }
        }
    }
    return new Promise((resolve) => {
        // 使用 spawn 启动子进程
        const proc = spawn(command, args, {
            shell: true,        // 在 shell 中运行，支持通配符和管道
            windowsHide: true,  // 在 Windows 下隐藏控制台窗口
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let truncated = false;

        // 辅助函数：如果字符串超出长度限制，进行截断并标记
        const truncate = (s: string): string => {
            if (s.length <= maxChars) return s;
            truncated = true;
            return s.slice(0, maxChars) + "\n...[输出已截断]";
        };

        // 监听标准输出流
        proc.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            // 策略：一旦累计输出超过限制，立即杀掉进程防止内存溢出
            if (stdout.length > maxChars) proc.kill("SIGTERM");
        });

        // 监听标准错误流
        proc.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > maxChars) proc.kill("SIGTERM");
        });

        // 设置定时器，防止进程长时间挂起（死循环或网络等待）
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill("SIGTERM"); // 超时则发送终止信号
        }, timeoutMs);

        // 进程结束（关闭）时的逻辑
        proc.on("close", (code, signal) => {
            clearTimeout(timer); // 清除超时定时器
            resolve({
                stdout: truncate(stdout),
                stderr: truncate(stderr),
                exitCode: code,
                timedOut,
                // 只要触发了截断逻辑或长度超限，即视为被截断
                truncated: truncated || stdout.length > maxChars || stderr.length > maxChars,
            });
        });

        // 处理启动失败等异常错误
        proc.on("error", (err) => {
            clearTimeout(timer);
            resolve({
                stdout: "",
                stderr: err.message,
                exitCode: null,
                timedOut: false,
                truncated: false,
            });
        });
    });
}
