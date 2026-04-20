/**
 * 创建并返回 Express 应用（Gateway 核心）
 * 职责：统一不同渠道（Web/QQ）的消息入口，处理会话状态，串联 AI Agent 逻辑
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { SessionKey } from "@/session/type";
import {
    resetSession,
} from "@/session/store";
import { appConfig } from "@/config/evn";
import { webchatAuth } from "./webchatAuth";
import { redactForLog } from "@/util/redact";
import { webChatChannelAdapter } from "@/channels/webchat/WebChatChannelAdapter";
import { qqChannelAdapter } from "@/channels/qq/QQChannelAdapter";
import type { QQOutboundContext } from "@/channels/qq/qqOutboundContext";
import { sendOneBotMessage } from "@/channels/qq/sendOneBotMessage";
import type { OneBotMessageEvent } from "@/channels/qq/oneBotTypes";
import { isBotMentioned } from "@/channels/qq/isBotMentioned";
import { handleUnifiedChat, DEFAULT_SESSION_KEY } from "./chatProcessing";
import { approveSessionChatRisk } from "@/session/riskApprovalSession";
import { registerTaskRoutes } from "./taskRoutes";
import { registerWorkspaceRoutes } from "./workspaceRoutes";
import { listModelsForClient } from "@/llm/modelCatalog";

/**
 * 解析已构建的前端静态目录（apps/web/dist），可通过 ONECLAW_WEB_DIST 覆盖。
 */
function resolveWebDistDir(): string | null {
    const env = process.env.ONECLAW_WEB_DIST?.trim();
    if (env && fs.existsSync(env)) {
        return env;
    }
    const sibling = path.resolve(process.cwd(), "../web/dist");
    if (fs.existsSync(sibling)) {
        return sibling;
    }
    return null;
}

/**
 * 创建并配置 Express 服务器的主函数
 */
export function createServer() {
    const app = express();

    // 解析 JSON 请求体，并限制大小为 5MB 以处理复杂 Payload
    app.use(express.json({ limit: "5mb" }));

    /**
     * 公开：是否配置了 WEBCHAT_TOKEN（前端据此区分「访客 / 需登录」），不经过 webchatAuth。
     */
    app.get("/api/auth/status", (_req, res) => {
        res.json({
            webchatTokenRequired: Boolean(appConfig.webchatToken?.trim()),
            uiLocale: appConfig.uiLocale,
        });
    });

    // 全局中间件：QQ Webhook、公开鉴权状态 /api/auth/* 不校验；其余走 webchatAuth
    app.use((req, res, next) => {
        if (req.path.startsWith("/api/qq")) return next();
        if (req.path.startsWith("/api/auth")) return next();
        // 前端启动/访客模式下也需要读取模型列表以供选择
        if (req.path.startsWith("/api/models")) return next();
        return webchatAuth(req, res, next);
    });

    const webDist = resolveWebDistDir();
    const publicDir = path.join(process.cwd(), "public");
    if (webDist) {
        app.use(express.static(webDist));
    }
    if (fs.existsSync(publicDir)) {
        app.use(express.static(publicDir));
    }

    /**
     * Web 端聊天接口
     * 将网页发送的消息转为统一格式并进入 handleUnifiedChat 流程
     */
    app.post("/api/chat", async (req, res) => {
        const ac = new AbortController();
        // 勿监听 req「close」：在 Node 中 body 读完后常会触发，并非客户端断开，会误杀进行中的 LLM。
        const onAbort = (): void => {
            if (!res.writableEnded) ac.abort();
        };
        req.on("aborted", onAbort);
        let sseStarted = false;
        try {
            const inbound = webChatChannelAdapter.parseInbound(req.body);
            if (!inbound) {
                res.status(400).json({ error: "无效的请求体，需包含 message（字符串）" });
                return;
            }
            const raw = req.body as { stream?: unknown };
            const wantStream =
                appConfig.chatSseEnabled === true && raw?.stream === true;

            if (wantStream) {
                sseStarted = true;
                res.status(200);
                res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("Connection", "keep-alive");
                if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
                    (res as { flushHeaders: () => void }).flushHeaders();
                }
                const sseWrite = (obj: Record<string, unknown>): void => {
                    res.write(`data: ${JSON.stringify(obj)}\n\n`);
                };
                await handleUnifiedChat(
                    inbound,
                    async (outbound) => {
                        sseWrite({
                            type: "final",
                            reply: outbound.text,
                            metadata: outbound.metadata ?? {},
                        });
                        res.end();
                    },
                    { abortSignal: ac.signal, sseWrite },
                );
            } else {
                await handleUnifiedChat(
                    inbound,
                    (outbound) => webChatChannelAdapter.sendOutbound(res, outbound),
                    { abortSignal: ac.signal },
                );
            }
        } catch (err) {
            console.error("/api/chat 错误:", redactForLog(err));
            const msg = err instanceof Error ? err.message : "服务器内部错误";
            if (sseStarted && !res.writableEnded) {
                try {
                    res.write(
                        `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`,
                    );
                    res.end();
                } catch {
                    /* ignore */
                }
            } else if (!res.headersSent) {
                res.status(500).json({ error: msg });
            }
        } finally {
            req.off("aborted", onAbort);
        }
    });

    /**
     * 无 taskId 时高风险工具：用户在聊天页确认后放行下一次同工具调用
     */
    app.post("/api/chat/approve-risk", async (req, res) => {
        try {
            const body = req.body as { sessionKey?: unknown; agentId?: unknown };
            const sessionKey =
                typeof body.sessionKey === "string" && body.sessionKey.trim() !== ""
                    ? body.sessionKey.trim()
                    : "";
            const agentId =
                typeof body.agentId === "string" && body.agentId.trim() !== ""
                    ? body.agentId.trim()
                    : "main";
            if (!sessionKey) {
                res.status(400).json({ error: "需要 sessionKey" });
                return;
            }
            const out = await approveSessionChatRisk(sessionKey as SessionKey, agentId);
            res.json({ ok: true, toolName: out.toolName });
        } catch (err) {
            console.error("/api/chat/approve-risk:", redactForLog(err));
            res.status(400).json({
                error: err instanceof Error ? err.message : "批准失败",
            });
        }
    });

    /**
     * 公开：模型列表（前端下拉框用）。不返回 apiKey 等敏感字段。
     */
    app.get("/api/models", (_req, res) => {
        try {
            res.json(listModelsForClient());
        } catch (err) {
            console.error("/api/models:", redactForLog(err));
            res.status(500).json({ error: err instanceof Error ? err.message : "服务器内部错误" });
        }
    });

    /**
     * QQ 机器人 Webhook 回调接口
     * 处理来自 OneBot 协议的消息通知
     */
    app.post("/api/qq/webhook", (req, res) => {
        // 如果配置中未开启 QQ 机器人，直接忽略
        if (!appConfig.qqBotEnabled) {
            res.status(200).send("");
            return;
        }

        // 基于 Bearer Token 的安全校验
        const configuredToken = appConfig.qqBotToken?.trim();
        if (configuredToken) {
            const authHeader = req.headers.authorization;
            const bearer = authHeader?.startsWith("Bearer ")
                ? authHeader.slice(7).trim()
                : "";
            if (bearer !== configuredToken) {
                res.status(403).send("");
                return;
            }
        }

        // 立即关闭 HTTP 响应连接，防止 QQ 平台因等待超时判定推送失败
        res.setHeader("Connection", "close");
        res.status(200).send("");

        // 启动异步处理闭包，不阻塞主接口返回
        (async () => {
            const ac = new AbortController();
            const onAbort = (): void => {
                if (!res.writableEnded) ac.abort();
            };
            req.on("aborted", onAbort);
            try {
                const inbound = qqChannelAdapter.parseInbound(req.body);
                if (!inbound) return;

                const ev = req.body as OneBotMessageEvent;
                // 对于群聊或频道消息，仅在机器人被 @ 时才做出反应
                if (ev.message_type === "group" || ev.message_type === "guild") {
                    if (!isBotMentioned(ev)) return;
                }

                // 构造出站上下文，用于定位回复的目标（私聊、群聊或子频道）
                const ctx: QQOutboundContext = {
                    messageType: (ev.message_type as "private" | "group" | "guild") || "private",
                    userId: String(ev.user_id ?? ""),
                    groupId: ev.group_id != null ? String(ev.group_id) : undefined,
                    guildId: ev.guild_id,
                    channelId: ev.channel_id,
                    sendMessage: (content) => sendOneBotMessage(ctx, content),
                };

                // 与 /api/chat 一致传入 abortSignal（此处响应已结束，writableEnded 为 true，不会因 req 误杀）
                await handleUnifiedChat(
                    inbound,
                    (outbound) => qqChannelAdapter.sendOutbound(ctx, outbound),
                    { abortSignal: ac.signal },
                );
            } catch (err) {
                console.error("/api/qq/webhook 异步处理错误:", redactForLog(err));
            } finally {
                req.off("aborted", onAbort);
            }
        })();
    });

    /**
     * 重置会话接口
     * 用于清除上下文，开启全新的对话
     */
    app.post("/api/session/reset", async (req, res) => {
        try {
            const body = req.body ?? {};
            const sessionKey: SessionKey =
                typeof body.sessionKey === "string" && body.sessionKey.trim() !== ""
                    ? (body.sessionKey.trim() as SessionKey)
                    : DEFAULT_SESSION_KEY;
            const agentId =
                typeof body.agentId === "string" && body.agentId.trim() !== ""
                    ? body.agentId.trim()
                    : "main";

            const sessionId = await resetSession(sessionKey, agentId);
            res.json({ sessionId });
        } catch (err) {
            console.error("/api/session/reset 错误:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
        }
    });
    registerTaskRoutes(app);
    registerWorkspaceRoutes(app);

    if (webDist && fs.existsSync(path.join(webDist, "index.html"))) {
        app.use((req, res, next) => {
            if (req.method !== "GET") {
                next();
                return;
            }
            if (req.path.startsWith("/api")) {
                next();
                return;
            }
            res.sendFile(path.join(webDist, "index.html"), (err) => {
                if (err) {
                    next(err);
                }
            });
        });
    }

    return app;
}

