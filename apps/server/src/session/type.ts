/**
 * 会话层类型：sessions.json + *.jsonl 转录
 */
export type SessionKey = string; // e.g. "main"
export interface SessionEntry {
    sessionId: string;
    updatedAt: string; // ISO 8601
}

/** sessions.json 内容：sessionKey -> SessionEntry */
export type SessionStore = Record<SessionKey, SessionEntry>;

/** 转录文件 .jsonl 中一行的结构 */
export interface TranscriptLine {
    id: string;
    role: "system" | "user" | "assistant";
    content: string;
}