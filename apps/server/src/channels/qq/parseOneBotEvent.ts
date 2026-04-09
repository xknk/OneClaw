import type { OneBotMessageEvent, OneBotMessageSegment } from "./oneBotTypes";

/**
 * 从 OneBot 的复杂消息结构中提取纯文本内容（屏蔽图片、CQ 码等，仅保留文字供 AI 推理）
 * @param message OneBot 原始消息，可能是字符串、数组或 undefined
 */
function extractText(message: string | OneBotMessageSegment[] | undefined): string {
    if (message == null) return "";
    // 场景 1：消息已经是纯字符串
    if (typeof message === "string") return message.trim();
    // 场景 2：消息是 Segment 数组（例如：[{type: 'text', data: {...}}, {type: 'image', ...}]）
    if (!Array.isArray(message)) return "";
    
    return message
        .filter((seg): seg is OneBotMessageSegment => 
            seg && typeof seg === "object" && seg.type === "text" // 只保留文本类型的片段
        )
        .map((seg) => (seg.data?.text != null ? String(seg.data.text) : ""))
        .join("")
        .trim();
}

/**
 * 【会话键生成逻辑】根据 OneBot 事件来源生成唯一的 sessionKey
 * 确保不同场景下的对话上下文相互独立：
 * - 群聊：qq:group:{群号}:{用户号}
 * - 频道：qq:channel:{频道号}:{用户号}
 * - 私聊：qq:private:{用户号}
 */
export function sessionKeyFromOneBotEvent(ev: OneBotMessageEvent): string {
    const uid = ev.user_id != null ? String(ev.user_id) : "";
    const gid = ev.group_id != null ? String(ev.group_id) : "";
    const cid = ev.channel_id != null ? String(ev.channel_id) : "";

    if (ev.message_type === "group" && gid) return `qq:group:${gid}:${uid}`;
    if (ev.message_type === "guild" && cid) return `qq:channel:${cid}:${uid}`;
    return `qq:private:${uid}`;
}

/**
 * 【主转换函数】将 OneBot 推送的原始事件对象转为系统通用的 UnifiedInboundMessage
 * @param ev Express 接收到的 req.body (OneBot 推送的 JSON)
 * @returns 转换成功返回标准消息对象，非消息类事件返回 null
 */
export function parseOneBotEventToInbound(ev: unknown): import("../unifiedMessage").UnifiedInboundMessage | null {
    // 1. 基础校验：必须是对象且 post_type 为 message
    if (!ev || typeof ev !== "object") return null;
    const e = ev as OneBotMessageEvent;
    if (e.post_type !== "message" || !e.message_type) return null;

    // 2. 提取文本内容：优先解析消息段数组，失败则尝试 raw_message
    const text = extractText(e.message) || (e.raw_message && String(e.raw_message).trim()) || "";
    if (!text) return null; // 如果没有任何有效文本（纯图片消息等），则忽略

    // 3. 构造 Session 标识
    const sessionKey = sessionKeyFromOneBotEvent(e);
    const userId = e.user_id != null ? String(e.user_id) : "";

    // 4. 返回标准入站消息格式
    return {
        channelId: "qq",           // 标记来源渠道
        channelUserId: userId,      // 用户在 QQ 平台的 ID
        sessionKey,                 // 对话上下文标识
        text,                       // 用户说的话
        timestamp: e.time != null 
            ? new Date(e.time * 1000).toISOString() // OneBot 时间戳通常是秒，转为 ISO 字符串
            : new Date().toISOString(),
    };
}
