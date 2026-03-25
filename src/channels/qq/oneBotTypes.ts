/**
 * OneBot v11 常见事件字段（兼容 QQ 机器人 / go-cqhttp / openclaw-qqbot 等）
 * 仅定义我们解析入站与回执所需的字段。
 */

export interface OneBotMessageEvent {
    post_type?: string;
    message_type?: "private" | "group" | "guild";
    sub_type?: string;
    /** 发送者 QQ 号 */
    user_id?: number | string;
    /** 群号（群消息时有） */
    group_id?: number | string;
    /** 频道相关（部分实现有） */
    guild_id?: string;
    channel_id?: string;
    /** 消息内容：字符串或 CQ 码数组 */
    message?: string | OneBotMessageSegment[];
    /** 原始消息字符串（部分实现直接给） */
    raw_message?: string;
    message_id?: number | string;
    self_id?: number | string;
    time?: number;
    sender?: { user_id?: number | string; nickname?: string;[k: string]: unknown };
}

export interface OneBotMessageSegment {
    type: string;
    data?: Record<string, string | number>;
}