/**
 * 无 taskId 的 WebChat 会话：高风险工具拦截与「一次放行」额度（持久在 sessions.json）。
 */
import { getOrCreateSessionId, readStore, writeStore } from "./store";
import type { ChatRiskPendingApproval, SessionKey } from "./type";

/** 尝试消耗一次某工具的放行额度；成功则返回 true 并持久化。 */
export async function tryConsumeChatRiskGrant(
    sessionKey: SessionKey,
    agentId: string,
    toolName: string,
): Promise<boolean> {
    const store = await readStore(agentId);
    const e = store[sessionKey];
    const n = e?.chatRiskGrants?.[toolName] ?? 0;
    if (n <= 0) return false;
    const grants = { ...(e!.chatRiskGrants ?? {}) };
    grants[toolName] = n - 1;
    if (grants[toolName] <= 0) delete grants[toolName];
    store[sessionKey] = {
        ...e!,
        chatRiskGrants: Object.keys(grants).length ? grants : undefined,
    };
    await writeStore(store, agentId);
    return true;
}

export async function setPendingChatRiskApproval(
    sessionKey: SessionKey,
    agentId: string,
    payload: ChatRiskPendingApproval,
): Promise<void> {
    await getOrCreateSessionId(sessionKey, agentId);
    const store = await readStore(agentId);
    const e = store[sessionKey];
    if (!e) return;
    store[sessionKey] = {
        ...e,
        chatRiskPendingApproval: payload,
    };
    await writeStore(store, agentId);
}

export async function getChatRiskPendingApproval(
    sessionKey: SessionKey,
    agentId: string,
): Promise<ChatRiskPendingApproval | null> {
    const store = await readStore(agentId);
    const p = store[sessionKey]?.chatRiskPendingApproval;
    return p && typeof p.toolName === "string" ? p : null;
}

/**
 * 用户在页面确认：为挂起中的工具增加一次放行额度，并清除挂起快照。
 */
export async function approveSessionChatRisk(
    sessionKey: SessionKey,
    agentId: string,
): Promise<{ toolName: string }> {
    const aid = agentId.trim() || "main";
    const sk = sessionKey.trim();
    const store = await readStore(aid);
    const e = store[sk];
    const p = e?.chatRiskPendingApproval;
    if (!p?.toolName?.trim()) {
        throw new Error("当前会话没有待批准的高风险操作");
    }
    const toolName = p.toolName.trim();
    const grants = { ...(e!.chatRiskGrants ?? {}) };
    grants[toolName] = (grants[toolName] ?? 0) + 1;
    store[sk] = {
        ...e!,
        chatRiskGrants: grants,
        chatRiskPendingApproval: undefined,
    };
    await writeStore(store, aid);
    return { toolName };
}
