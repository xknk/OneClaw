import { appendTraceEvent } from "./traceWriter"; // 导入负责 IO 写入的方法
import type { TraceEvent, TraceEventType } from "./traceTypes"; // 导入类型定义

/**
 * 追踪基础上下文接口
 * 包含单次请求中通常保持不变的标识符（如用户 ID、机器人 ID 等）
 */
export interface TraceBase {
    traceId: string;    // 全局唯一的请求链路 ID
    sessionKey: string; // 当前会话的标识
    agentId: string;    // 执行任务的智能体 ID
    channelId: string;  // 访问渠道（Web/API 等）
    profileId: string;  // 最终用户的身份 ID
}

/**
 * 发送/记录追踪事件的核心函数
 * 
 * @param base 基础上下文。要求 traceId 必传，其他字段可选 (Partial)
 * @param eventType 当前触发的事件类型 (如 'llm.request')
 * @param patch 补丁数据。除了 traceId, timestamp, eventType 之外的所有 TraceEvent 字段
 *              (利用 Omit 排除掉由本函数内部生成的字段，防止外部误传覆盖)
 */
export async function emitTrace(
    base: Partial<TraceBase> & { traceId: string },
    eventType: TraceEventType,
    patch?: Omit<TraceEvent, "traceId" | "timestamp" | "eventType">
): Promise<void> {

    // 1. 构建完整的事件对象
    const event: TraceEvent = {
        // --- 强制填充的元数据 ---
        traceId: base.traceId,
        timestamp: new Date().toISOString(), // 统一生成当前时间的 ISO 字符串
        eventType,

        // --- 从上下文 base 中提取的业务标识 ---
        sessionKey: base.sessionKey,
        agentId: base.agentId,
        channelId: base.channelId,
        profileId: base.profileId,

        // --- 合并 patch 传入的额外信息 ---
        // 例如：durationMs, toolName, ok, errorCode 等
        ...patch,
    };

    // 2. 调用写入器将事件持久化（通常是写入本地 .jsonl 文件）
    await appendTraceEvent(event);
}
