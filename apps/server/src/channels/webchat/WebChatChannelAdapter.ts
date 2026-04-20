// src/channels/webchat/WebChatChannelAdapter.ts

import type { Response } from "express";
import type { ChannelAdapter } from "../ChannelAdapter";
import {
    UnifiedOutboundMessage,
    createInboundFromWebChatBody,
    UnifiedInboundMessage,
} from "../unifiedMessage";

/**
 * WebChat 渠道适配器：
 * 作用：处理 Web 端网页聊天窗口的消息转换。
 * - 入站：将前端发送的 HTTP JSON 请求体解析为系统统一的 UnifiedInboundMessage 格式。
 * - 出站：将系统生成的 UnifiedOutboundMessage 通过 Express 的 Response 对象以 JSON 形式返回。
 */
export class WebChatChannelAdapter implements ChannelAdapter {
    // 渠道唯一标识
    public readonly channelId = "webchat";

    /**
     * 将前端发来的原始数据转换为系统内部标准格式
     * @param raw 原始请求体 (通常是 req.body)
     */
    parseInbound(raw: unknown): UnifiedInboundMessage | null {
        // 调用统一转换逻辑，如果格式不符通常返回 null
        return createInboundFromWebChatBody(raw);
    }

    /**
     * 将系统回复发送给前端
     * @param target 发送目标，在 WebChat 模式下，这必须是 Express 的 Response 对象
     * @param message 系统生成的统一出站消息
     */
    async sendOutbound(target: unknown, message: UnifiedOutboundMessage): Promise<void> {
        // 类型断言：确保 target 是 Express 的 Response 对象
        const res = target as Response | undefined;

        if (!res) {
            // 如果因为某些原因（如异步超时已响应）丢失了 res 对象，则终止操作防止崩溃
            console.warn("[WebChatAdapter] Missing response object, message dropped.");
            return;
        }

        // 最终返回给前端的协议格式：{ reply, metadata }（metadata 含 taskStatus / 待审批快照等）
        res.json({
            reply: message.text,
            ...(message.metadata && Object.keys(message.metadata).length > 0
                ? { metadata: message.metadata }
                : {}),
        });
    }
}

/** 
 * 导出单例：
 * 避免在多个地方实例化，节省内存且方便直接在路由处理函数中引用
 */
export const webChatChannelAdapter = new WebChatChannelAdapter();
