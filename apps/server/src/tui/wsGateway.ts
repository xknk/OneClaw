import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { UnifiedInboundMessage } from "@/channels/unifiedMessage";
import { newCliConversationSessionKey } from "@/cli/cliSessionKey";
import { handleUnifiedChat } from "@/server/chatProcessing";
import { ollamaConfig, zhipuConfig } from "@/config/evn";
import { listModelsForClient, loadModelsCatalog } from "@/llm/modelCatalog";

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
    modelId?: string;
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
            modelId?: string;
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

function defaultModelIdFromCatalog(): string | undefined {
    try {
        return loadModelsCatalog().defaultModelId;
    } catch {
        return undefined;
    }
}

/** 当前连接上正在执行的 chat（串行队列里至多一条） */
type InflightChat = { requestId: string; ac: AbortController };

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
        const fallbackSessionKey = newCliConversationSessionKey();
        const chatQueue: Array<{
            body: NonNullable<ReturnType<typeof parseClientMessage>>;
        }> = [];
        let draining = false;
        let inflight: InflightChat | null = null;
        // 💡 默认模型：连接建立即用 models.json 的 defaultModelId（避免首包尚未带 modelId 时落到硬编码 zhipu）
        let currentModelType: "ollama" | "zhipu" | undefined = undefined;
        let currentModelId: string | undefined = defaultModelIdFromCatalog();
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
                    if (typeof body.modelId === "string" && body.modelId.trim()) {
                        currentModelId = body.modelId.trim();
                    }
                    if (body.type !== "chat" || typeof body.text !== "string") continue;
                    const text = body.text.trim();
                    if (!text) continue;
                    const rawRid = body.requestId;
                    const requestId =
                        typeof rawRid === "string" && rawRid.trim()
                            ? rawRid.trim()
                            : typeof rawRid === "number"
                              ? String(rawRid)
                              : undefined;
                    /** 必须始终随帧下发：JSON.stringify 会丢掉 undefined，否则 TUI 的 done 无法匹配 req-*，busy 永久为 true */
                    const echoRid = requestId ?? "";
                    const ridForCancel = echoRid;

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "started", requestId: echoRid }));
                    }

                    const ac = new AbortController();
                    inflight = { requestId: ridForCancel, ac };

                    const inbound: UnifiedInboundMessage = {
                        channelId: "webchat",
                        channelUserId: "tui-local",
                        sessionKey:
                            typeof body.sessionKey === "string" && body.sessionKey.trim()
                                ? body.sessionKey.trim()
                                : fallbackSessionKey,
                        text,
                        timestamp: new Date().toISOString(),
                        ...(typeof body.agentId === "string" && body.agentId.trim()
                            ? { agentId: body.agentId.trim() }
                            : {}),
                        ...(typeof body.taskId === "string" && body.taskId.trim()
                            ? { taskId: body.taskId.trim() }
                            : {}),
                        ...(currentModelId ? { modelId: currentModelId } : {}),
                        ...(!currentModelId && currentModelType ? { modelType: currentModelType } : {}),
                    };

                    try {
                        await handleUnifiedChat(
                            inbound,
                            async (outbound) => {
                                if (ws.readyState === WebSocket.OPEN) {
                                    const outText = String(outbound.text ?? "");
                                    ws.send(
                                        JSON.stringify({
                                            type: "assistant",
                                            requestId: echoRid,
                                            text: outText,
                                            metadata: outbound.metadata,
                                        })
                                    );
                                    if (!outText.trim()) {
                                        ws.send(
                                            JSON.stringify({
                                                type: "error",
                                                requestId: echoRid,
                                                message: "模型返回空结果，请重试或缩短问题。",
                                            })
                                        );
                                    }
                                }
                            },
                            {
                                abortSignal: ac.signal,
                                sseWrite: (obj: Record<string, unknown>): void => {
                                    if (ws.readyState !== WebSocket.OPEN || !echoRid) return;
                                    if (obj.type === "delta" && typeof obj.text === "string" && obj.text) {
                                        ws.send(
                                            JSON.stringify({
                                                type: "delta",
                                                requestId: echoRid,
                                                text: obj.text,
                                            })
                                        );
                                        return;
                                    }
                                    /** LLM 轮次 / 模型事件：TUI 展示「思考中 / 请求中」 */
                                    if (obj.type === "model" && obj.event && typeof obj.event === "object") {
                                        ws.send(
                                            JSON.stringify({
                                                type: "phase",
                                                requestId: echoRid,
                                                event: obj.event,
                                            })
                                        );
                                        return;
                                    }
                                    /** 工具即将执行（参数预览） */
                                    if (
                                        obj.type === "tool_start" &&
                                        typeof obj.toolName === "string" &&
                                        obj.toolName.trim()
                                    ) {
                                        ws.send(
                                            JSON.stringify({
                                                type: "tool_start",
                                                requestId: echoRid,
                                                toolName: obj.toolName.trim(),
                                                argsPreview:
                                                    typeof obj.argsPreview === "string" ? obj.argsPreview : "",
                                            })
                                        );
                                        return;
                                    }
                                    /** runAgent 工具结束后回调（含参数与输出摘要，Claude-code 风格块） */
                                    if (obj.type === "tool" && typeof obj.toolName === "string" && obj.toolName.trim()) {
                                        ws.send(
                                            JSON.stringify({
                                                type: "tool",
                                                requestId: echoRid,
                                                toolName: obj.toolName.trim(),
                                                ok: obj.ok === true,
                                                durationMs:
                                                    typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs)
                                                        ? obj.durationMs
                                                        : 0,
                                                argsPreview:
                                                    typeof obj.argsPreview === "string" ? obj.argsPreview : "",
                                                resultPreview:
                                                    typeof obj.resultPreview === "string" ? obj.resultPreview : "",
                                            })
                                        );
                                    }
                                },
                            },
                        );
                    } catch (e) {
                        const message = e instanceof Error ? e.message : String(e);
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(
                                JSON.stringify({
                                    type: "error",
                                    requestId: echoRid,
                                    message,
                                })
                            );
                        }
                    } finally {
                        inflight = null;
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "done", requestId: echoRid }));
                        }
                    }
                }
            } finally {
                draining = false;
                /** 处理中再次入队的消息需继续 drain，否则会永远留在队列里 */
                if (chatQueue.length > 0) {
                    void drainChatQueue();
                }
            }
        };
        const config = currentModelType === "ollama" ? ollamaConfig : zhipuConfig;
        let modelsPayload: ReturnType<typeof listModelsForClient>;
        try {
            modelsPayload = listModelsForClient();
        } catch {
            modelsPayload = { defaultModelId: "zhipu", models: [] };
        }
        ws.send(
            JSON.stringify({
                type: "ready",
                version: appVersion,
                model: currentModelType,
                baseUrl: config.baseUrl,
                models: modelsPayload,
            })
        );

        ws.on("close", () => {
            inflight?.ac.abort();
        });

        ws.on("message", (raw) => {
            const body = parseClientMessage(raw);
            if (!body) return;
            if (body.type === "cancel") {
                const cr =
                    typeof body.requestId === "string" && body.requestId.trim()
                        ? body.requestId.trim()
                        : "";
                if (inflight && (!cr || inflight.requestId === cr)) {
                    inflight.ac.abort();
                }
                return;
            }
            if (body.type !== "chat" || typeof body.text !== "string") {
                if (body.type !== "chat" && body.type !== "cancel") {
                    ws.send(JSON.stringify({ type: "error", message: "仅支持 type: chat 或 cancel" }));
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
