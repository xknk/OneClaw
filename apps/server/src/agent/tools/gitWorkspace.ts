/**
 * 在允许目录下执行 git（不走 shell，降低注入风险）。由 git_read / git_write 分流子命令。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs/promises";
import { appConfig } from "../../config/evn";
import { resolveInWorkspace } from "./workspace";

const execFileAsync = promisify(execFile);

const GIT_READ_ROOTS = new Set([
    "status",
    "diff",
    "log",
    "show",
    "branch",
    "describe",
    "rev-parse",
    "blame",
    "grep",
    "ls-files",
    "merge-base",
    "whatchanged",
    "name-rev",
    "shortlog",
    "help",
    "version",
    "--version",
]);

const GIT_WRITE_ROOTS = new Set([
    "add",
    "commit",
    "push",
    "pull",
    "fetch",
    "merge",
    "rebase",
    "checkout",
    "switch",
    "reset",
    "cherry-pick",
    "init",
    "clone",
    "mv",
    "rm",
    "clean",
    "stash",
    "worktree",
    "remote",
    "tag",
    "config",
    "submodule",
]);

function assertGitArgvSafe(argv: string[]): void {
    if (argv.length === 0) {
        throw new Error("git 参数 args 不能为空");
    }
    if (argv.length > 80) {
        throw new Error("git 参数过多");
    }
    for (const a of argv) {
        if (typeof a !== "string") {
            throw new Error("git 参数须全部为字符串");
        }
        if (a.length > 12_000) {
            throw new Error("git 单个参数过长");
        }
        if (/[\n\r\0]/.test(a)) {
            throw new Error("git 参数含非法换行");
        }
        if (/[`]|\$\(|;\s*git|\|\|\s*git|&&\s*git/.test(a)) {
            throw new Error("git 参数含禁止片段");
        }
    }
}

/** 将 git 调用分为只读或写入（未知子命令视为 deny，避免误放行） */
export function classifyGitInvocation(argv: string[]): "read" | "write" | "deny" {
    const a0 = argv[0]!;
    if (a0.startsWith("-") && a0 !== "--version") {
        return "deny";
    }
    if (a0 === "stash") {
        if (argv.length === 1) return "read";
        const a1 = argv[1];
        if (a1 === "list" || a1 === "show") return "read";
        return "write";
    }
    if (a0 === "remote") {
        if (argv.length === 1) return "read";
        if (argv[1] === "-v" || argv[1] === "--verbose") return "read";
        if (argv[1] === "show" || argv[1] === "get-url" || argv[1] === "get-url-all") return "read";
        return "write";
    }
    if (a0 === "tag") {
        if (argv.length === 1) return "read";
        if (argv[1] === "-l" || argv[1] === "--list") return "read";
        return "write";
    }
    if (a0 === "config") {
        if (argv.includes("--get") || argv.includes("--get-all") || argv.includes("--get-regexp")) return "read";
        if (argv[1] === "--list" || argv[1] === "-l") return "read";
        return "write";
    }
    if (a0 === "submodule") {
        if (argv[1] === "status" || argv[1] === "foreach") return "read";
        return "write";
    }
    if (GIT_READ_ROOTS.has(a0)) return "read";
    if (GIT_WRITE_ROOTS.has(a0)) return "write";
    return "deny";
}

async function resolveGitWorkingDirectory(cwdInput: string): Promise<string> {
    const trimmed = cwdInput.trim() || ".";
    const resolved = resolveInWorkspace(trimmed, "read");
    let st;
    try {
        st = await fs.stat(resolved);
    } catch {
        throw new Error(`工作目录不存在或不可访问: ${trimmed}`);
    }
    if (!st.isDirectory()) {
        throw new Error(`working_directory 必须是目录: ${trimmed}`);
    }
    return resolved;
}

export async function runGitRead(cwdInput: string, argv: string[]): Promise<string> {
    assertGitArgvSafe(argv);
    const mode = classifyGitInvocation(argv);
    if (mode !== "read") {
        throw new Error(
            mode === "deny"
                ? "该 git 子命令未在白名单内；请换用 git_write（若为写入）或检查参数。"
                : "该调用属于写入类 git 命令，请使用 git_write。",
        );
    }
    const cwd = await resolveGitWorkingDirectory(cwdInput);
    const maxOut = Math.min(appConfig.execMaxOutputChars, 2_000_000);
    try {
        const { stdout, stderr } = await execFileAsync("git", argv, {
            cwd,
            windowsHide: true,
            maxBuffer: maxOut + 64_000,
            encoding: "utf8",
        });
        const parts = [`exitCode: 0`, stdout ? `stdout:\n${stdout}` : `stdout:`, stderr ? `stderr:\n${stderr}` : ``];
        return parts.filter(Boolean).join("\n");
    } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; code?: number };
        const msg = `exitCode: ${err.code ?? "?"}\nstdout:\n${err.stdout ?? ""}\nstderr:\n${err.stderr ?? ""}`;
        return msg;
    }
}

export async function runGitWrite(cwdInput: string, argv: string[]): Promise<string> {
    assertGitArgvSafe(argv);
    const mode = classifyGitInvocation(argv);
    if (mode === "deny") {
        throw new Error("该 git 子命令未在白名单内；请检查参数或使用 exec（若策略允许）。");
    }
    if (mode !== "write") {
        throw new Error("该调用为只读 git 命令，请使用 git_read。");
    }
    const cwd = await resolveGitWorkingDirectory(cwdInput);
    const maxOut = Math.min(appConfig.execMaxOutputChars, 2_000_000);
    try {
        const { stdout, stderr } = await execFileAsync("git", argv, {
            cwd,
            windowsHide: true,
            maxBuffer: maxOut + 64_000,
            encoding: "utf8",
        });
        return [`exitCode: 0`, stdout ? `stdout:\n${stdout}` : `stdout:`, stderr ? `stderr:\n${stderr}` : ``]
            .filter(Boolean)
            .join("\n");
    } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; code?: number };
        return `exitCode: ${err.code ?? "?"}\nstdout:\n${err.stdout ?? ""}\nstderr:\n${err.stderr ?? ""}`;
    }
}

/** 供测试：是否视为只读 git 调用 */
export function isGitReadInvocation(argv: string[]): boolean {
    return classifyGitInvocation(argv) === "read";
}
