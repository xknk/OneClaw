import { spawn } from "node:child_process";

function splitArgs(input: string): string[] {
    return input
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function normalizeSlash(line: string): string[] {
    const tokens = splitArgs(line);
    if (tokens.length === 0) return [];
    const [first, ...rest] = tokens;
    if (!first.startsWith("/")) return [];
    return [first.slice(1), ...rest];
}

function allowAsTerminalCommand(cmd: string): boolean {
    return cmd === "onboard" || cmd === "doctor" || cmd === "task" || cmd === "t" || cmd === "trace" || cmd === "tr";
}

export async function runTerminalSlash(line: string): Promise<string | null> {
    const argv = normalizeSlash(line);
    if (argv.length === 0) return null;
    const [cmd, ...rest] = argv;
    if (!cmd) return null;

    if (cmd === "start") {
        return "命令 /start 需要常驻运行，建议在独立终端执行：pnpm cli start";
    }
    if (cmd === "repl" || cmd === "tui") {
        return `当前已在终端会话内，无需执行 /${cmd}。`;
    }
    if (!allowAsTerminalCommand(cmd)) {
        return null;
    }

    /**
     * Windows：未指定 shell 时无法直接 spawn .cmd，会报 spawn EINVAL。
     * 使用 shell: true 由系统解析 PATH 中的 pnpm。
     */
    const args = ["cli", cmd, ...rest];

    return await new Promise<string>((resolve) => {
        const child = spawn("pnpm", args, {
            stdio: ["ignore", "pipe", "pipe"],
            ...(process.platform === "win32" ? { shell: true } : {}),
        });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (buf) => {
            stdout += String(buf);
        });
        child.stderr.on("data", (buf) => {
            stderr += String(buf);
        });
        child.on("error", (err) => {
            resolve(`执行失败: ${err.message}`);
        });
        child.on("close", (code) => {
            const out = stdout.trim();
            const err = stderr.trim();
            if (code === 0) {
                resolve(out || "命令执行完成。");
                return;
            }
            resolve(
                [`命令执行失败 (exit ${code ?? "?"})`, out, err]
                    .filter(Boolean)
                    .join("\n")
            );
        });
    });
}
