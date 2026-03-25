import type { OneBotMessageEvent, OneBotMessageSegment } from "./oneBotTypes";

/**
 * 判断当前消息是否 @ 了机器人（群聊/频道场景下用于“仅 @ 时回复”）
 * - 私聊不要求 @，直接视为“已提及”
 * - 群/频道：检查 message 数组里是否有 type=at 且 data.qq == self_id；或 raw_message 含 [CQ:at,qq=self_id]
 */
export function isBotMentioned(ev: OneBotMessageEvent): boolean {
    const selfId = ev.self_id != null ? String(ev.self_id) : "";
    if (!selfId) return true; // 无法确定机器人 ID 时，保守处理：都回复

    if (ev.message_type === "private") return true;

    const msg = ev.message;
    if (Array.isArray(msg)) {
        const atSeg = msg.find(
            (seg: OneBotMessageSegment) =>
                seg.type === "at" && seg.data && String(seg.data.qq) === selfId
        );
        if (atSeg) return true;
    }

    const raw = ev.raw_message && String(ev.raw_message);
    if (raw && raw.includes(`[CQ:at,qq=${selfId}]`)) return true;

    return false;
}