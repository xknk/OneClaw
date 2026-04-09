export type ChatMessage = { role: "user" | "assistant"; text: string };

export type Conversation = {
    id: string;
    title: string;
    sessionKey: string;
    agentId: string;
    intent: string;
    taskId: string;
    updatedAt: string;
    messages: ChatMessage[];
};
