import type { UnifiedInboundMessage, UnifiedOutboundMessage } from "./unifiedMessage";

/**
 * 渠道适配器接口：
 * - 负责把“渠道原始事件/请求”解析为统一入站消息；
 * - 负责把统一出站消息交还给渠道（可选，视场景而定）。
 */
export interface ChannelAdapter {
    /** 渠道标识，如 "webchat" / "discord" */
    readonly channelId: string;

    /**
     * 将原始输入解析为统一入站消息。
     * 解析失败时返回 null（由上层决定如何报错）。
     */
    parseInbound(raw: unknown): UnifiedInboundMessage | null;

    /**
     * 发送统一出站消息到渠道。
     * 对于 HTTP WebChat，这通常是写入 HTTP 响应；
     * 对于 Bot 渠道，则是调用对应 API。
     *
     * 这里保持通用签名：由调用方提供“目标上下文”（如 Express res）。
     */
    sendOutbound(target: unknown, message: UnifiedOutboundMessage): Promise<void>;
}