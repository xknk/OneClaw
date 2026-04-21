/**
 * 无 taskId 的 WebChat 会话：高风险工具拦截与按工具名的放行额度（持久在 sessions.json）。
 * 默认 burst=1 且不按「全工具」充值：每次敏感操作前通常需再次确认。
 */
import { appConfig } from "@/config/evn";
import { HIGH_RISK_BUILTIN_TOOL_NAMES } from "@/security/highRiskBuiltinTools";
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

/** 用户用自然语言「拒绝」时：仅清除挂起快照，不增加放行额度 */
export async function dismissSessionChatRisk(sessionKey: SessionKey, agentId: string): Promise<void> {
    const aid = agentId.trim() || "main";
    const sk = sessionKey.trim();
    const store = await readStore(aid);
    const e = store[sk];
    if (!e?.chatRiskPendingApproval) return;
    store[sk] = { ...e, chatRiskPendingApproval: undefined };
    await writeStore(store, aid);
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
    const burst = Math.max(1, appConfig.chatRiskSessionApprovalBurst);
    const grants = { ...(e!.chatRiskGrants ?? {}) };
    if (appConfig.chatRiskSessionApproveAllHighRisk) {
        for (const name of HIGH_RISK_BUILTIN_TOOL_NAMES) {
            grants[name] = (grants[name] ?? 0) + burst;
        }
    } else {
        grants[toolName] = (grants[toolName] ?? 0) + burst;
    }
    store[sk] = {
        ...e!,
        chatRiskGrants: grants,
        chatRiskPendingApproval: undefined,
    };
    await writeStore(store, aid);
    return { toolName };
}
