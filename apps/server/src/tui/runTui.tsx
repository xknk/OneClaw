import React from "react";
import { render } from "ink";
import { startTuiWsServer } from "./wsGateway";
import { TuiApp } from "./TuiApp";

function defaultTuiPort(): number {
    const v = process.env.ONECLAW_TUI_WS_PORT;
    if (v && /^\d+$/.test(v)) {
        const n = Number(v);
        if (n >= 1 && n <= 65535) return n;
    }
    return 18789;
}

export async function runTuiCli(opts: {
    port?: number;
    session?: string;
    agent?: string;
    task?: string;
}): Promise<void> {
    process.env.ONECLAW_TUI = "1";
    const port = opts.port ?? defaultTuiPort();
    let gateway: Awaited<ReturnType<typeof startTuiWsServer>>;
    try {
        gateway = await startTuiWsServer(port);
    } catch (e) {
        console.error(
            `[tui] WebSocket 端口 ${port} 不可用（换一个：pnpm cli tui -p <port> 或 ONECLAW_TUI_WS_PORT）：`,
            e instanceof Error ? e.message : e
        );
        process.exitCode = 1;
        return;
    }

    const { waitUntilExit } = render(
        <TuiApp
            wsUrl={gateway.url}
            defaultSession={opts.session?.trim() || "cli"}
            agentId={opts.agent?.trim() || undefined}
            taskId={opts.task?.trim() || undefined}
        />,
        { exitOnCtrlC: false }
    );

    await waitUntilExit();
    await gateway.close();
}
