/**
 * QQ 渠道出站时需要的上下文：从哪里来回哪里去（私聊/群/频道 + 目标 ID）
 * sendMessage 由 Gateway 在收到 OneBot 事件后构造，内部调用 OneBot API 发消息。
 */
export interface QQOutboundContext {
    messageType: "private" | "group" | "guild";
    userId: string;
    groupId?: string;
    guildId?: string;
    channelId?: string;
    /** 实际发送逻辑：Gateway 注入，调用 OneBot HTTP API */
    sendMessage(content: string): Promise<void>;
}