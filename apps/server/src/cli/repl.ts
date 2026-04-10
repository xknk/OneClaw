import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CompleterResult } from "node:readline";
import type { UnifiedInboundMessage } from "@/channels/unifiedMessage";
import { handleUnifiedChat } from "@/server/chatProcessing";
import { appConfig } from "@/config/evn";
import { getSlashCommandEntries } from "@/cli/slashCommands";
import { runTerminalSlash } from "@/cli/terminalCommandRunner";
import * as T from "@/tui/tuiStrings";

export interface ReplOptions {
    sessionKey?: string;
    agentId?: string;
    taskId?: string;
    verbose?: boolean;
}

function replCompleter(line: string): CompleterResult {
    const SLASH_COMMANDS = getSlashCommandEntries(appConfig.uiLocale).map((e) => e.cmd);
    const m = line.match(/^(\s*)(\/\S*)$/);
    if (!m) return [[], line];
    const ws = m[1];
    const tok = m[2];
    const hits = SLASH_COMMANDS.filter((c) => c.startsWith(tok));
    const list = hits.length ? [...hits] : [...SLASH_COMMANDS];
    return [list, ws + tok];
}

function printReplHelp(opts: {
    sessionKey: string;
    taskId?: string;
    verbose: boolean;
}): void {
    const loc = appConfig.uiLocale;
    console.log(T.tuiHelpLines(loc, { sessionKey: opts.sessionKey, taskId: opts.taskId }));
    console.log(T.replHelpAppend(loc));
    if (opts.verbose) {
        console.log(loc === "en" ? "verbose: on." : "当前: verbose=开。");
    }
}

function printStatus(opts: {
    sessionKey: string;
    agentId?: string;
    taskId?: string;
    verbose: boolean;
}): void {
    console.log(T.replStatusLines(appConfig.uiLocale, opts));
}

/**
 * 终端多轮对话：直连 handleUnifiedChat，与 POST /api/chat 同一处理链。
 */
export async function runRepl(opts: ReplOptions = {}): Promise<void> {
    const state = {
        sessionKey: opts.sessionKey?.trim() || "cli",
        agentId: opts.agentId?.trim() || undefined,
        taskId: opts.taskId?.trim() || undefined,
        verbose: !!opts.verbose,
    };

    const rl = readline.createInterface({
        input,
        output,
        terminal: true,
        completer: replCompleter,
    });

    console.log(
        T.replBannerLine(appConfig.uiLocale, {
            sessionKey: state.sessionKey,
            agentId: state.agentId,
            taskId: state.taskId,
        }),
    );
    console.log(T.replPromptLine(appConfig.uiLocale));

    const onSigInt = (): void => {
        console.log(T.replSigint(appConfig.uiLocale));
        rl.close();
        process.exit(0);
    };
    process.once("SIGINT", onSigInt);

    try {
        for (;;) {
            const raw = await rl.question("> ");
            const text = raw.trim();
            if (!text) continue;

            if (text === "/exit" || text === "/quit") break;

            if (text === "/") {
                const rows = getSlashCommandEntries(appConfig.uiLocale);
                const header = appConfig.uiLocale === "en" ? "Commands:\n" : "可用命令:\n";
                console.log(
                    header + rows.map((e) => `  ${e.cmd.padEnd(12)} ${e.desc}`).join("\n"),
                );
                continue;
            }

            if (text === "/help" || text === "/?") {
                printReplHelp({
                    sessionKey: state.sessionKey,
                    taskId: state.taskId,
                    verbose: state.verbose,
                });
                continue;
            }

            if (text === "/clear") {
                console.clear();
                continue;
            }

            if (text === "/status") {
                printStatus({
                    sessionKey: state.sessionKey,
                    agentId: state.agentId,
                    taskId: state.taskId,
                    verbose: state.verbose,
                });
                continue;
            }

            if (text === "/workspace") {
                const { tuiWorkspaceLines } = await import("@/tui/tuiStrings");
                console.log(tuiWorkspaceLines(appConfig.uiLocale));
                continue;
            }

            if (text.startsWith("/session")) {
                const rest = text.slice("/session".length).trim();
                if (!rest) {
                    console.error(T.replSessionUsage(appConfig.uiLocale));
                    continue;
                }
                state.sessionKey = rest;
                console.log(T.replSessionSwitchedMsg(appConfig.uiLocale, state.sessionKey, state.taskId));
                continue;
            }

            if (text.startsWith("/")) {
                const out = await runTerminalSlash(text);
                if (out !== null) {
                    console.log(out);
                    continue;
                }
                console.error(T.replUnknown(appConfig.uiLocale));
                continue;
            }

            const inbound: UnifiedInboundMessage = {
                channelId: "webchat",
                channelUserId: "cli-local",
                sessionKey: state.sessionKey,
                text,
                timestamp: new Date().toISOString(),
                ...(state.agentId ? { agentId: state.agentId } : {}),
                ...(state.taskId ? { taskId: state.taskId } : {}),
            };

            try {
                await handleUnifiedChat(inbound, async (outbound) => {
                    console.log(outbound.text);
                    if (state.verbose && outbound.metadata) {
                        const meta = outbound.metadata as Record<string, unknown>;
                        if (meta.traceId) {
                            console.error(`[traceId] ${meta.traceId}`);
                        }
                        if (Object.keys(meta).length > 0) {
                            console.error("[meta]", JSON.stringify(meta));
                        }
                    }
                });
            } catch (err) {
                console.error("[repl]", err instanceof Error ? err.message : err);
            }
        }
    } finally {
        process.off("SIGINT", onSigInt);
        rl.close();
    }
}
