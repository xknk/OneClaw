import type { UiLocale } from "@/config/evn";

/**
 * TUI / REPL 共用：斜杠命令元数据（供选择菜单与补全）。
 */
export type SlashCommandEntry = {
    cmd: string;
    desc: string;
    /** 需要参数，单独一行 Enter 不执行，仅提示用法 */
    needsArg?: boolean;
};

const SLASH_ZH: SlashCommandEntry[] = [
    { cmd: "/help", desc: "显示内置命令与说明" },
    { cmd: "/?", desc: "同 /help" },
    { cmd: "/session", desc: "切换会话键：/session <key>", needsArg: true },
    { cmd: "/clear", desc: "清空本窗口消息列表" },
    { cmd: "/status", desc: "会话、模型与目录摘要" },
    { cmd: "/workspace", desc: "配置文件路径（MCP、模板、技能、agents）" },
    { cmd: "/onboard", desc: "初始化配置与 workspace" },
    { cmd: "/doctor", desc: "运行系统自检并输出建议" },
    { cmd: "/task", desc: "任务命令入口：/task <subcommand>", needsArg: true },
    { cmd: "/t", desc: "task 别名：/t <subcommand>", needsArg: true },
    { cmd: "/trace", desc: "trace 命令入口：/trace <subcommand>", needsArg: true },
    { cmd: "/tr", desc: "trace 别名：/tr <subcommand>", needsArg: true },
    { cmd: "/start", desc: "启动 Gateway（建议在独立终端执行）" },
    { cmd: "/exit", desc: "退出 TUI" },
];

const SLASH_EN: SlashCommandEntry[] = [
    { cmd: "/help", desc: "Built-in commands and help" },
    { cmd: "/?", desc: "Same as /help" },
    { cmd: "/session", desc: "Switch session key: /session <key>", needsArg: true },
    { cmd: "/clear", desc: "Clear messages in this window" },
    { cmd: "/status", desc: "Session, model, and paths summary" },
    { cmd: "/workspace", desc: "Config file paths (MCP, templates, skills, agents)" },
    { cmd: "/onboard", desc: "Initialize config and workspace" },
    { cmd: "/doctor", desc: "Run system self-check" },
    { cmd: "/task", desc: "Task CLI: /task <subcommand>", needsArg: true },
    { cmd: "/t", desc: "Alias for /task", needsArg: true },
    { cmd: "/trace", desc: "Trace CLI: /trace <subcommand>", needsArg: true },
    { cmd: "/tr", desc: "Alias for /trace", needsArg: true },
    { cmd: "/start", desc: "Start Gateway (use a separate terminal)" },
    { cmd: "/exit", desc: "Exit TUI" },
];

/** @deprecated 使用 {@link getSlashCommandEntries} */
export const SLASH_COMMAND_ENTRIES: SlashCommandEntry[] = SLASH_ZH;

export function getSlashCommandEntries(locale: UiLocale): SlashCommandEntry[] {
    return locale === "en" ? SLASH_EN : SLASH_ZH;
}

/** 行首 `/` 且尚未输入空格时显示选择菜单 */
export function isSlashMenuLine(line: string): boolean {
    return line.startsWith("/") && !line.includes(" ");
}

export function filterSlashCommands(line: string, locale: UiLocale): SlashCommandEntry[] {
    const list = getSlashCommandEntries(locale);
    const token = line.trim();
    if (!token.startsWith("/")) return [];
    if (token === "/") return [...list];
    return list.filter((e) => e.cmd.startsWith(token));
}

export function uniqueSlashLabels(entries: SlashCommandEntry[]): SlashCommandEntry[] {
    const seen = new Set<string>();
    const out: SlashCommandEntry[] = [];
    for (const e of entries) {
        if (seen.has(e.cmd)) continue;
        seen.add(e.cmd);
        out.push(e);
    }
    return out;
}
