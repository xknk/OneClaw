import type { Conversation } from "@/chat/types";

function keyForUser(userId: string): string {
    return `oneclaw.chats.${userId}`;
}

export function loadConversations(userId: string): Conversation[] {
    try {
        const raw = localStorage.getItem(keyForUser(userId));
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed as Conversation[];
    } catch {
        return [];
    }
}

export function saveConversations(userId: string, list: Conversation[]): void {
    localStorage.setItem(keyForUser(userId), JSON.stringify(list));
}

export function createEmptyConversation(defaultTitle: string): Conversation {
    return {
        id: crypto.randomUUID(),
        title: defaultTitle,
        sessionKey: `u-${crypto.randomUUID()}`,
        agentId: "main",
        modelId: "",
        intent: "",
        taskId: "",
        agentLocked: false,
        updatedAt: new Date().toISOString(),
        messages: [],
    };
}
