// src/channels/qq/sendOneBotMessage.ts

import { appConfig } from "@/config/evn";
import type { QQOutboundContext } from "./qqOutboundContext";

/**
 * 【底层执行函数】调用 OneBot 标准 API 接口发送消息。
 * 作用：将文本内容通过 HTTP POST 请求发送到机器人后端（如 Go-CQHTTP / Lagrange）。
 * 
 * @param ctx 发送上下文，包含消息类型（私聊/群聊）和对应的 ID
 * @param content 要发送的文本内容
 */
export async function sendOneBotMessage(ctx: QQOutboundContext, content: string): Promise<void> {
    // 1. 获取基础配置（API 地址），如 http://127.0.0.1:5700
    const base = appConfig.qqBotApiBaseUrl?.trim();
    if (!base) {
        console.warn("[QQ] 未配置 API 基础路径，消息发送已被拦截。");
        return;
    }

    // 2. 准备鉴权 Header (如果 OneBot 配置了 Access Token)
    const token = appConfig.qqBotToken?.trim();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    let action: string; // OneBot 的动作名称
    let params: Record<string, string | number>; // 传递给 API 的参数

    // 3. 根据消息类型选择对应的 OneBot 终点 (Endpoint)
    if (ctx.messageType === "private") {
        // 私聊消息
        action = "send_private_msg";
        params = { 
            user_id: Number(ctx.userId) || ctx.userId, 
            message: content 
        };
    } else if (ctx.messageType === "group") {
        // 群聊消息
        action = "send_group_msg";
        params = { 
            group_id: Number(ctx.groupId!) || ctx.groupId!, 
            message: content 
        };
    } else {
        // 频道消息 (Guild)
        // 注意：不同 OneBot 实现（如 NapCat 或 Go-CQ）对频道的接口名可能略有差异
        action = "send_guild_channel_msg";
        params = {
            guild_id: ctx.guildId!,
            channel_id: ctx.channelId!,
            message: content,
        };
    }

    // 4. 拼接完整 URL 并发起 HTTP 请求
    const url = `${base.replace(/\/$/, "")}/${action}`;
    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
    });

    // 5. 错误处理
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`OneBot API ${action} 失败: HTTP ${res.status} - 详情: ${t}`);
    }
}
