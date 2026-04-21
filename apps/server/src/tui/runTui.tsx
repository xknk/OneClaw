import React from "react";
import { render } from "ink";
import { newCliConversationSessionKey } from "@/cli/cliSessionKey";
import { startTuiWsServer } from "./wsGateway";
import { TuiApp } from "./TuiApp";

const DEFAULT_TUI_WS_PORT = 18789;
const AUTO_PORT_TRY_COUNT = 100;

function parseEnvTuiPort(): number | undefined {
    const v = process.env.ONECLAW_TUI_WS_PORT;
    if (v && /^\d+$/.test(v)) {
        const n = Number(v);
        if (n >= 1 && n <= 65535) return n;
    }
    return undefined;
}

function resolveTuiPortBinding(opts: { port?: number }): {
    startPort: number;
    allowAlternatePorts: boolean;
} {
    if (opts.port !== undefined) {
        return { startPort: opts.port, allowAlternatePorts: false };
    }
    const fromEnv = parseEnvTuiPort();
    if (fromEnv !== undefined) {
        return { startPort: fromEnv, allowAlternatePorts: false };
    }
    return { startPort: DEFAULT_TUI_WS_PORT, allowAlternatePorts: true };
}

function isAddrInUse(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "EADDRINUSE"
    );
}

async function bindTuiWsServer(opts: { port?: number }): Promise<
    | { ok: true; gateway: Awaited<ReturnType<typeof startTuiWsServer>> }
    | { ok: false; error: unknown; lastTriedPort: number; allowAlternatePorts: boolean }
> {
    const { startPort, allowAlternatePorts } = resolveTuiPortBinding(opts);
    const maxAttempts = allowAlternatePorts ? AUTO_PORT_TRY_COUNT : 1;
    let lastError: unknown;
    let lastTriedPort = startPort;

    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (port > 65535) break;
        lastTriedPort = port;
        try {
            const gateway = await startTuiWsServer(port);
            if (allowAlternatePorts && port !== startPort) {
                console.warn(
                    `[tui] 默认端口 ${startPort} 已被占用，已改用 ${port}（可用 ONECLAW_TUI_WS_PORT 或 pnpm cli tui -p <port> 固定端口）`
                );
            }
            return { ok: true, gateway };
        } catch (e) {
            lastError = e;
            if (allowAlternatePorts && isAddrInUse(e)) {
                continue;
            }
            return { ok: false, error: e, lastTriedPort: port, allowAlternatePorts };
        }
    }

    return {
        ok: false,
        error: lastError ?? new Error("EADDRINUSE"),
        lastTriedPort,
        allowAlternatePorts,
    };
}

export async function runTuiCli(opts: {
    port?: number;
    session?: string;
    agent?: string;
    task?: string;
}): Promise<void> {
    process.env.ONECLAW_TUI = "1";
    const bound = await bindTuiWsServer(opts);
    if (!bound.ok) {
        const { startPort, allowAlternatePorts } = resolveTuiPortBinding(opts);
        if (allowAlternatePorts) {
            const endPort = Math.min(startPort + AUTO_PORT_TRY_COUNT - 1, 65535);
            console.error(
                `[tui] 无法在 ${startPort}–${endPort} 内找到可用 WebSocket 端口：`,
                bound.error instanceof Error ? bound.error.message : bound.error
            );
        } else {
            console.error(
                `[tui] WebSocket 端口 ${bound.lastTriedPort} 不可用（换一个：pnpm cli tui -p <port> 或 ONECLAW_TUI_WS_PORT）：`,
                bound.error instanceof Error ? bound.error.message : bound.error
            );
        }
        process.exitCode = 1;
        return;
    }
    const gateway = bound.gateway;

    const { waitUntilExit } = render(
        <TuiApp
            wsUrl={gateway.url}
            defaultSession={opts.session?.trim() || newCliConversationSessionKey()}
            agentId={opts.agent?.trim() || undefined}
            taskId={opts.task?.trim() || undefined}
        />,
        /** patchConsole 默认 true 时与 cmd 全屏重绘叠加易闪屏；关闭后避免 console 劫持，一般更稳 */
        { exitOnCtrlC: false, patchConsole: false }
    );

    await waitUntilExit();
    await gateway.close();
}
