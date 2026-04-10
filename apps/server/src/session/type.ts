/**
 * 会话层类型：sessions.json + *.jsonl 转录
 */
export type SessionKey = string; // e.g. "main"
export interface SessionEntry {
    sessionId: string;
    updatedAt: string; // ISO 8601
    /** 已从转录开头折入滚动摘要的消息条数（仅模型视图，不删 jsonl） */
    archivedMessageCount?: number;
    rollingSummary?: string;
}

/** sessions.json 内容：sessionKey -> SessionEntry */
export type SessionStore = Record<SessionKey, SessionEntry>;

/** 转录文件 .jsonl 中一行的结构 */
export interface TranscriptLine {
    id: string;
    role: "system" | "user" | "assistant";
    content: string;
}