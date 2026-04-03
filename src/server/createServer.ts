/**
 * 创建并返回 Express 应用（Gateway 核心）
 * 职责：统一不同渠道（Web/QQ）的消息入口，处理会话状态，串联 AI Agent 逻辑
 */

import express from "express";
import path from "path";
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
import { registerTaskRoutes } from "./taskRoutes";

/**
 * 创建并配置 Express 服务器的主函数
 */
export function createServer() {
    const app = express();

    // 解析 JSON 请求体，并限制大小为 5MB 以处理复杂 Payload
    app.use(express.json({ limit: "5mb" }));

    // 全局中间件：除了 QQ 机器人的 Webhook（由对方服务器鉴权），其他接口执行 webchat 鉴权
    app.use((req, res, next) => {
        if (req.path.startsWith("/api/qq")) return next();
        return webchatAuth(req, res, next);
    });

    // 托管公共静态资源（前端 UI 界面）
    const publicDir = path.join(process.cwd(), "public");
    app.use(express.static(publicDir));

    // 根路径跳转到 index.html
    app.get("/", (_req, res) => {
        res.sendFile(path.join(publicDir, "index.html"));
    });

    /**
     * Web 端聊天接口
     * 将网页发送的消息转为统一格式并进入 handleUnifiedChat 流程
     */
    app.post("/api/chat", async (req, res) => {
        try {
            const inbound = webChatChannelAdapter.parseInbound(req.body);
            if (!inbound) {
                res.status(400).json({ error: "无效的请求体，需包含 message（字符串）" });
                return;
            }
            // 网页端直接通过 HTTP Response 返回结果
            await handleUnifiedChat(inbound, (outbound) =>
                webChatChannelAdapter.sendOutbound(res, outbound)
            );
        } catch (err) {
            console.error("/api/chat 错误:", redactForLog(err));
            res.status(500).json({
                error: err instanceof Error ? err.message : "服务器内部错误",
            });
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

                // 进入统一处理流程，回复逻辑由 qqChannelAdapter 提供
                await handleUnifiedChat(inbound, (outbound) =>
                    qqChannelAdapter.sendOutbound(ctx, outbound)
                );
            } catch (err) {
                console.error("/api/qq/webhook 异步处理错误:", redactForLog(err));
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

    return app;
}

