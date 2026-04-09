import type { ChannelAdapter } from "../ChannelAdapter";
import type { UnifiedInboundMessage, UnifiedOutboundMessage } from "../unifiedMessage";
import { parseOneBotEventToInbound } from "./parseOneBotEvent";
import type { QQOutboundContext } from "./qqOutboundContext";

/**
 * QQ 渠道适配器（基于 OneBot v11 协议标准）：
 * 职责：
 * 1. 【入站】将 OneBot 推送的原始 JSON 事件，解析为系统统一的 UnifiedInboundMessage。
 * 2. 【出站】将 AI 生成的统一回复 UnifiedOutboundMessage，通过 QQ 特有的上下文发送出去。
 */
export class QQChannelAdapter implements ChannelAdapter {
    // 渠道唯一标识，用于区分 WebChat 或其他平台
    public readonly channelId = "qq";

    /**
     * 解析逻辑：直接复用 parseOneBotEvent.ts 中的解析函数
     * 将 QQ 的原始事件转为带 sessionKey 的标准格式
     */
    parseInbound(raw: unknown): UnifiedInboundMessage | null {
        return parseOneBotEventToInbound(raw);
    }

    /**
     * 发送逻辑：
     * @param target 发送目标。在 QQ 渠道中，这通常是一个封装了 API 调用（如 OneBot API）的上下文对象。
     * @param message AI 生成的待发送消息
     */
    async sendOutbound(target: unknown, message: UnifiedOutboundMessage): Promise<void> {
        // 类型断言：告诉编译器将 target 视为拥有 sendMessage 方法的对象
        const ctx = target as QQOutboundContext | undefined;

        // 安全检查：如果上下文无效或没有发送函数，则丢弃消息并记录日志
        if (!ctx?.sendMessage) {
            console.warn("[QQChannelAdapter] 缺少 QQOutboundContext 或 sendMessage 方法，消息回复失败。");
            return;
        }

        // 调用具体的发送逻辑，将文本发送回 QQ 群或私聊
        await ctx.sendMessage(message.text);
    }
}

// 导出单例，方便在服务器路由中统一调用
export const qqChannelAdapter = new QQChannelAdapter();
