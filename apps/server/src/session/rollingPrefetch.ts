/**
 * 一轮对话结束后在后台把「当前转录 + 滚动状态」推进到与 buildMessagesForModel 一致，
 * 下一轮用户发消息时若预跑已完成，可少做甚至不做同步摘要 LLM 调用。
 */
import { appConfig } from "@/config/evn";
import { buildMessagesForModel } from "@/session/buildModelContext";
import { getRollingState, setRollingState, type RollingState } from "@/session/store";
import type { SessionKey } from "@/session/type";
import { readMessages } from "@/session/transcript";

const prefetchChains = new Map<string, Promise<void>>();

function chainKey(agentId: string, sessionKey: SessionKey): string {
    return `${agentId}::${sessionKey}`;
}

/** 等待同会话上一条后台预跑结束（新请求开始时应先调用，避免与本轮 build 竞态） */
export async function awaitRollingPrefetchIdle(
    sessionKey: SessionKey,
    agentId: string
): Promise<void> {
    const p = prefetchChains.get(chainKey(agentId, sessionKey));
    if (p) await p;
}

/**
 * 在助手回复已写入转录后调度：将 rolling 推进到对应当前完整 transcript 的状态。
 */
export function scheduleRollingPrefetchAfterAssistant(
    sessionKey: SessionKey,
    agentId: string,
    sessionId: string
): void {
    if (!appConfig.chatRollingPrefetchEnabled) return;

    const k = chainKey(agentId, sessionKey);
    const prev = prefetchChains.get(k) ?? Promise.resolve();
    const next = prev
        .then(async () => {
            const full = await readMessages(sessionId, agentId);
            const rolling: RollingState = await getRollingState(sessionKey, agentId);
            const built = await buildMessagesForModel(full, rolling);
            await setRollingState(sessionKey, agentId, built.rolling);
        })
        .catch((e) => {
            console.error("[rolling prefetch] failed:", e);
        })
        .then(() => {});
    prefetchChains.set(k, next);
}
