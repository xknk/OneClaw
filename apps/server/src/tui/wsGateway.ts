import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { UnifiedInboundMessage } from "@/channels/unifiedMessage";
import { handleUnifiedChat } from "@/server/chatProcessing";
import { ollamaConfig, zhipuConfig } from "@/config/evn";

const pkgDir = dirname(fileURLToPath(import.meta.url));
let appVersion = "0";
try {
    const raw = readFileSync(join(pkgDir, "../../package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    if (typeof pkg.version === "string") appVersion = pkg.version;
} catch {
    /* ignore */
}

function parseClientMessage(raw: RawData): {
    modelType?: "ollama" | "zhipu";
    type?: string;
    text?: string;
    requestId?: string;
    sessionKey?: string;
    agentId?: string;
    taskId?: string;
} | null {
    try {
        return JSON.parse(String(raw)) as {
            modelType?: "ollama" | "zhipu";
            type?: string;
            text?: string;
            requestId?: string;
            sessionKey?: string;
            agentId?: string;
            taskId?: string;
        };
    } catch {
        return null;
    }
}

/**
 * 本机 WebSocket：供 TUI 连接，每帧 chat 走 handleUnifiedChat（与 REPL / WebChat 同链）。
 */
export async function startTuiWsServer(port: number): Promise<{
    url: string;
    close: () => Promise<void>;
}> {
    const wss = new WebSocketServer({ port });

    await new Promise<void>((resolve, reject) => {
        wss.once("listening", () => resolve());
        wss.once("error", (e) => reject(e));
    });

    wss.on("connection", (ws: WebSocket) => {
        const chatQueue: Array<{
            body: NonNullable<ReturnType<typeof parseClientMessage>>;
        }> = [];
        let draining = false;
        // 💡 默认模型设为 zhipu
        let currentModelType: "ollama" | "zhipu" | undefined = undefined; 
        const drainChatQueue = async (): Promise<void> => {
            if (draining) return;
            draining = true;
            try {
                while (chatQueue.length) {
                    const item = chatQueue.shift();
                    if (!item?.body) continue;
                    const body = item.body;
                    // 💡 在处理具体请求前，如果消息里带了 modelType，则更新当前连接的模型指向
                    if (body.modelType === "ollama" || body.modelType === "zhipu") {
                        currentModelType = body.modelType;
                    }
                    if (body.type !== "chat" || typeof body.text !== "string") continue;
                    const text = body.text.trim();
                    if (!text) continue;
                    const requestId =
                        typeof body.requestId === "string" && body.requestId.trim()
                            ? body.requestId.trim()
                            : undefined;

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "started", requestId }));
                    }

                    const inbound: UnifiedInboundMessage = {
                        channelId: "webchat",
                        channelUserId: "tui-local",
                        sessionKey:
                            typeof body.sessionKey === "string" && body.sessionKey.trim()
                                ? body.sessionKey.trim()
                                : "cli",
                        text,
                        timestamp: new Date().toISOString(),
                        ...(typeof body.agentId === "string" && body.agentId.trim()
                            ? { agentId: body.agentId.trim() }
                            : {}),
                        ...(typeof body.taskId === "string" && body.taskId.trim()
                            ? { taskId: body.taskId.trim() }
                            : {}),
                        ...(currentModelType ? { modelType: currentModelType } : {}),
                    };

                    try {
                        await handleUnifiedChat(inbound, async (outbound) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                const outText = String(outbound.text ?? "");
                                ws.send(
                                    JSON.stringify({
                                        type: "assistant",
                                        requestId,
                                        text: outText,
                                        metadata: outbound.metadata,
                                    })
                                );
                                if (!outText.trim()) {
                                    ws.send(
                                        JSON.stringify({
                                            type: "error",
                                            requestId,
                                            message: "模型返回空结果，请重试或缩短问题。",
                                        })
                                    );
                                }
                            }
                        });
                    } catch (e) {
                        const message = e instanceof Error ? e.message : String(e);
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(
                                JSON.stringify({
                                    type: "error",
                                    requestId,
                                    message,
                                })
                            );
                        }
                    } finally {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "done", requestId }));
                        }
                    }
                }
            } finally {
                draining = false;
            }
        };
        const config = currentModelType === "ollama" ? ollamaConfig : zhipuConfig;
        ws.send(
            JSON.stringify({
                type: "ready",
                version: appVersion,
                model: currentModelType,
                baseUrl: config.baseUrl,
            })
        );

        ws.on("message", (raw) => {
            const body = parseClientMessage(raw);
            if (!body) return;
            if (body.type !== "chat" || typeof body.text !== "string") {
                if (body.type !== "chat") {
                    ws.send(JSON.stringify({ type: "error", message: "仅支持 type: chat" }));
                }
                return;
            }
            const text = body.text.trim();
            if (!text) return;
            chatQueue.push({ body });
            void drainChatQueue();
        });
    });

    const url = `ws://127.0.0.1:${port}`;
    return {
        url,
        close: () =>
            new Promise((resolve) => {
                wss.close(() => resolve());
            }),
    };
}
