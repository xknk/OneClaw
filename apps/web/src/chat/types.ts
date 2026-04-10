export type ChatMessage = { role: "user" | "assistant"; text: string };

export type Conversation = {
    id: string;
    title: string;
    sessionKey: string;
    agentId: string;
    intent: string;
    taskId: string;
    /** 为 true 时服务端不因任务计划步覆盖用户选择的 agentId */
    agentLocked?: boolean;
    updatedAt: string;
    messages: ChatMessage[];
};
