/**
 * 会话层类型：sessions.json + *.jsonl 转录
 */
export type SessionKey = string; // e.g. "main"
/** WebChat 无 taskId 时高风险工具挂起（待 POST /api/chat/approve-risk） */
export type ChatRiskPendingApproval = {
    toolName: string;
    argsSummary: string;
    requestedAt: string;
    traceId?: string;
};

export interface SessionEntry {
    sessionId: string;
    updatedAt: string; // ISO 8601
    /** 已从转录开头折入滚动摘要的消息条数（仅模型视图，不删 jsonl） */
    archivedMessageCount?: number;
    rollingSummary?: string;
    consecutiveFailures?: number; // 连续失败次数
    /**
     * 用户批准后，对指定工具名的「下一次调用」放行次数（无 task 场景）。
     * 与任务级 v4_approval_grants 独立。
     */
    chatRiskGrants?: Record<string, number>;
    /** 最近一次被拦截、尚未在页面确认的高风险调用快照 */
    chatRiskPendingApproval?: ChatRiskPendingApproval;
}

/** sessions.json 内容：sessionKey -> SessionEntry */
export type SessionStore = Record<SessionKey, SessionEntry>;

/** 转录文件 .jsonl 中一行的结构 */
export interface TranscriptLine {
    id: string;
    role: "system" | "user" | "assistant";
    content: string;
}