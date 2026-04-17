/**
 * 智能对话全链路管理工具
 * 
 * 核心功能：
 * 1. 输入侧：五级 Pipeline 压缩 (Compact -> Tool Budget -> Snip -> Microcompact -> Collapse)
 * 2. 输出侧：Token 预算监控 (checkTokenBudget) - 自动识别“断头”并续写
 * 3. 性能侧：Cache 友好架构 (摘要前置策略)
 */

import type { ChatMessage } from "@/llm/providers/ModelProvider";
import { appConfig } from "@/config/evn";
import {
    estimateMessagesTokens,
    trimMessagesToTokenBudget,
    estimateTextTokens,
} from "@/session/contextLimit";
import { mergeRollingSummary } from "@/session/summarizeContext";
import type { RollingState } from "@/session/store";

// --- 【类型定义】 ---

export interface BudgetTracker {
    continuationCount: number;    // 自动续接的次数
    lastGlobalTurnTokens: number; // 上一轮累计消耗的总 Token
    lastDeltaTokens: number;      // 上一轮新增的 Token 数量
}

export type TokenBudgetDecision = {
    action: 'continue' | 'stop';
    nudgeMessage?: string;        // 引导模型继续说话的提示语
    pct?: number;                 // 当前消耗百分比
};

export type BuildModelContextResult = {
    messages: ChatMessage[];
    rolling: RollingState;
};

// --- 【常量配置】 ---
const COMPLETION_THRESHOLD = 0.9; // 消耗达到 90% 时停止自动续接，防止截断
const DIMINISHING_THRESHOLD = 500; // 边际递减阈值：如果产出低于 500 Token，视为低效输出

// --- 【核心逻辑 1：五级压缩 Pipeline】 ---

/** 第一级：边界截取 */
function getMessagesAfterCompactBoundary(messages: ChatMessage[]): ChatMessage[] {
    let lastBoundaryIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'system' && messages[i].content?.includes("__COMPACT_BOUNDARY__")) {
            lastBoundaryIdx = i;
            break;
        }
    }
    return lastBoundaryIdx === -1 ? messages : messages.slice(lastBoundaryIdx + 1);
}

/** 第二级：工具结果限额 */
function applyToolResultBudget(messages: ChatMessage[], budget: number): ChatMessage[] {
    return messages.map(msg => {
        const isTool = (msg.role as string) === 'tool' || !!(msg as any).tool_calls;
        if (!isTool) return msg;
        return estimateTextTokens(msg.content) > budget
            ? { ...msg, content: `[内容过长已折叠: ${estimateTextTokens(msg.content)} tokens]` }
            : msg;
    });
}

/** 第三级：Snip 零成本裁剪 (剔除旧工具记录) */
function snipCompactIfNeeded(messages: ChatMessage[]): ChatMessage[] {
    return messages.filter((msg, idx) => {
        if (msg.role === 'tool' && idx < messages.length - 3) return false;
        return true;
    });
}

/** 第四级：Microcompact 细粒度清洗 (正则) */
function microcompactMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => ({
        ...msg,
        content: (msg.content || "").replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{3,}/g, ' ').trim()
    }));
}

/** 核心组装：Cache 友好型 (人设 -> 摘要 -> 活跃对话) */
function assembleFinalMessages(summary: string, tail: ChatMessage[]): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    msgs.push({ role: "system", content: "你是一个专业的助手。" });
    if (summary.trim()) {
        msgs.push({ role: "system", content: `[历史背景回顾]\n${summary.trim()}` });
    }
    msgs.push(...tail);
    return msgs;
}

/**
 * 第五级：Context Collapse (主流程)
 */
export async function buildMessagesForModel(
    fullMessages: ChatMessage[],
    rolling: RollingState
): Promise<BuildModelContextResult> {
    const { chatHistoryMaxTokens: MAX_HIST, chatSingleMessageMaxTokens: SINGLE_MAX, chatContextReserveMessages: MIN_RESERVE } = appConfig;

    let workingMessages = getMessagesAfterCompactBoundary(fullMessages);
    workingMessages = applyToolResultBudget(workingMessages, SINGLE_MAX * 0.6);
    workingMessages = snipCompactIfNeeded(workingMessages);
    workingMessages = microcompactMessages(workingMessages);

    let { rollingSummary, archivedMessageCount } = rolling;
    let currentTokens = estimateMessagesTokens(workingMessages) + estimateTextTokens(rollingSummary);

    // 触发 Collapse 坍缩逻辑
    if (currentTokens > MAX_HIST && workingMessages.length > MIN_RESERVE) {
        const itemsToMergeCount = Math.max(1, Math.floor(workingMessages.length * 0.4));
        const batch = workingMessages.slice(0, itemsToMergeCount);
        try {
            rollingSummary = await mergeRollingSummary(rollingSummary, batch);
            archivedMessageCount += itemsToMergeCount;
            workingMessages = workingMessages.slice(itemsToMergeCount);
            workingMessages.unshift({ role: "system", content: `__COMPACT_BOUNDARY__\n已归档历史。` });
        } catch (e) { console.error("Collapse error", e); }
    }

    let finalMessages = assembleFinalMessages(rollingSummary, workingMessages);
    // 物理保底
    if (estimateMessagesTokens(finalMessages) > MAX_HIST) {
        finalMessages = trimMessagesToTokenBudget(finalMessages, { maxTokens: MAX_HIST, singleMessageMaxTokens: SINGLE_MAX });
    }

    return { messages: finalMessages, rolling: { rollingSummary, archivedMessageCount, consecutiveFailures: 0 } };
}

// --- 【核心逻辑 2：输出端预算监控 & 自动续杯】 ---

/**
 * 检查当前 Token 消耗，决定是否需要“自动续杯”
 * @param tracker 追踪器状态
 * @param budget 总 Token 预算上限
 * @param globalTurnTokens 本轮请求已消耗的总 Token
 */
export function checkTokenBudget(
    tracker: BudgetTracker,
    budget: number | null,
    globalTurnTokens: number,
): TokenBudgetDecision {
    if (budget === null || budget <= 0) return { action: 'stop' };

    const pct = Math.round((globalTurnTokens / budget) * 100);
    const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens;

    // 判定边际递减效应：如果续接了多次且产出速度明显放缓，则强制止损
    const isDiminishing =
        tracker.continuationCount >= 3 &&
        deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
        tracker.lastDeltaTokens < DIMINISHING_THRESHOLD;

    // 逻辑：如果没进入低效率状态，且消耗尚未达到 90% 的安全线，则允许续杯
    if (!isDiminishing && globalTurnTokens < budget * COMPLETION_THRESHOLD) {
        tracker.continuationCount++;
        tracker.lastDeltaTokens = deltaSinceLastCheck;
        tracker.lastGlobalTurnTokens = globalTurnTokens;

        return {
            action: 'continue',
            nudgeMessage: "请继续刚才未完成的内容。",
            pct
        };
    }

    // 否则停止（预算耗尽、产出效率低、或已接近模型最大输出限制）
    return { action: 'stop', pct };
}

// --- 【核心逻辑 3：后台维护】 ---

export async function triggerBackgroundMaintenance(
    fullMessages: ChatMessage[],
    rolling: RollingState,
    onUpdate: (next: RollingState) => Promise<void>
) {
    const rawTail = fullMessages.slice(rolling.archivedMessageCount);
    if (estimateMessagesTokens(rawTail) > appConfig.chatHistoryMaxTokens * 0.9) {
        try {
            const batchSize = Math.floor(rawTail.length * 0.5);
            const batch = microcompactMessages(rawTail.slice(0, batchSize));
            const newSummary = await mergeRollingSummary(rolling.rollingSummary, batch);
            await onUpdate({
                rollingSummary: newSummary,
                archivedMessageCount: rolling.archivedMessageCount + batchSize,
                consecutiveFailures: 0
            });
        } catch (e) { console.warn("Background Maintenance failed"); }
    }
}
