export type ChatMessage = { role: "user" | "assistant"; text: string };

export type Conversation = {
    id: string;
    title: string;
    sessionKey: string;
    agentId: string;
    /** 选择的模型 id（来自 /api/models）；为空表示使用服务端 defaultModelId */
    modelId?: string;
    intent: string;
    taskId: string;
    /** 为 true 时服务端不因任务计划步覆盖用户选择的 agentId */
    agentLocked?: boolean;
    updatedAt: string;
    messages: ChatMessage[];
};
