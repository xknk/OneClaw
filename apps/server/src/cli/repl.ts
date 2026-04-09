import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CompleterResult } from "node:readline";
import type { UnifiedInboundMessage } from "@/channels/unifiedMessage";
import { handleUnifiedChat } from "@/server/chatProcessing";
import { appConfig, ollamaConfig } from "@/config/evn";
import { SLASH_COMMAND_ENTRIES } from "@/cli/slashCommands";
import { runTerminalSlash } from "@/cli/terminalCommandRunner";

export interface ReplOptions {
    sessionKey?: string;
    agentId?: string;
    taskId?: string;
    verbose?: boolean;
}

const SLASH_COMMANDS = SLASH_COMMAND_ENTRIES.map((e) => e.cmd);

function replCompleter(line: string): CompleterResult {
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
    const lines = [
        "内置命令:",
        "  /help, /?         显示本帮助",
        "  /session <key>     切换会话键（仅影响未带 --task 时的转录）",
        "  /clear             清屏（不清对话历史）",
        "  /status            当前 REPL 与会话目录、模型等摘要",
        "  /onboard           运行初始化",
        "  /doctor            运行系统自检",
        "  /task ...          执行任务命令（同 pnpm cli task ...）",
        "  /trace ...         执行 trace 命令（同 pnpm cli trace ...）",
        "  /exit, /quit       退出",
        "",
        "行首输入 `/` 后按 Tab 可补全上述命令；单独输入 `/` 回车可列出命令。",
        "",
        "启动参数（pnpm cli repl …）:",
        "  --session <key>    初始会话键，默认 cli",
        "  --agent <id>       Agent ID",
        "  --task <taskId>    关联任务（转录固定为 task:<id>）",
        "  -v, --verbose      stderr 打印 traceId / metadata",
        "",
        "提示: 与 pnpm dev 同时开时，勿与 Web 共用同一 sessionKey。",
    ];
    if (opts.taskId) {
        lines.push(
            "",
            `当前: 已关联 --task ${opts.taskId}，转录键 task:${opts.taskId}（与 sessionKey=${opts.sessionKey} 并存）。`
        );
    }
    console.log(lines.join("\n"));
    if (opts.verbose) {
        console.log("当前: verbose=开。");
    }
}

function printStatus(opts: {
    sessionKey: string;
    agentId?: string;
    taskId?: string;
    verbose: boolean;
}): void {
    console.log(
        [
            "REPL 状态:",
            `  sessionKey: ${opts.sessionKey}`,
            `  agentId: ${opts.agentId ?? "(未指定)"}`,
            `  taskId: ${opts.taskId ?? "(未指定)"}`,
            `  verbose: ${opts.verbose}`,
            "",
            "配置摘要:",
            `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
            `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
            `  skillsDir → ${appConfig.skillsDir}`,
            `  Ollama → ${ollamaConfig.baseUrl} · model ${ollamaConfig.modelName}`,
        ].join("\n")
    );
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
        `OneClaw REPL · sessionKey=${state.sessionKey}` +
            (state.agentId ? ` · agentId=${state.agentId}` : "") +
            (state.taskId ? ` · taskId=${state.taskId}` : "")
    );
    console.log("输入消息回车发给模型；/help 帮助；行首 `/` + Tab 补全；/exit 退出。\n");

    const onSigInt = (): void => {
        console.log("\n[repl] 已退出（SIGINT）");
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
                console.log(
                    "可用命令:\n" +
                        SLASH_COMMAND_ENTRIES.map((e) => `  ${e.cmd.padEnd(12)} ${e.desc}`).join("\n")
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

            if (text.startsWith("/session")) {
                const rest = text.slice("/session".length).trim();
                if (!rest) {
                    console.error("用法: /session <key>");
                    continue;
                }
                state.sessionKey = rest;
                console.log(`已切换 sessionKey=${state.sessionKey}`);
                if (state.taskId) {
                    console.log(
                        "（提示：当前仍带 --task，实际转录键仍为 task:<taskId>。）"
                    );
                }
                continue;
            }

            if (text.startsWith("/")) {
                const out = await runTerminalSlash(text);
                if (out !== null) {
                    console.log(out);
                    continue;
                }
                console.error("未知命令。输入 /help 或 `/` + Tab。");
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
