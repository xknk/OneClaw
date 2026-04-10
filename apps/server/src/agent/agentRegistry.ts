// src/agent/agentResolver.ts

import type { UnifiedInboundMessage, UnifiedIntent } from "@/channels/unifiedMessage";
import type { TraceDecisionSource } from "@/observability/traceTypes";
import type { PlanStep } from "@/tasks/collaborationTypes";
import {
    getAgentBindings,
    getAgentConfigById,
    type AgentConfig as ExternalAgentConfig,
} from "@/agent/loadAgentRegistry";

/**
 * 定义当前系统支持的 Agent 唯一标识符类型
 */
export type AgentId = "main" | "frontend" | "daily_report" | "code_review";

/**
 * 兜底配置：当找不到任何匹配的 Agent 时使用
 */
const FALLBACK_MAIN: ExternalAgentConfig = {
    id: "main",
    displayName: "Main",
};

/**
 * 类型守卫：将不确定的输入归一化为标准的意图(Intent)类型
 */
function normalizeIntent(v: unknown): UnifiedIntent | undefined {
    if (v === "chat" || v === "daily_report" || v === "code_review") return v;
    return undefined;
}

/**
 * 核心匹配逻辑：遍历所有绑定规则
 * 按照 频道ID -> 会话前缀 -> 文本开头 -> 文本包含 的顺序进行校验
 */
function matchBinding(inbound: UnifiedInboundMessage): string | null {
    const text = inbound.text?.trim() ?? "";
    const bindings = getAgentBindings();

    for (const r of bindings) {
        // 如果规则指定了频道，但当前消息频道不符，跳过
        if (r.channelId && r.channelId !== inbound.channelId) continue;
        // 如果规则指定了会话前缀（如特定用户群），不匹配则跳过
        if (r.sessionKeyPrefix && !inbound.sessionKey.startsWith(r.sessionKeyPrefix)) continue;
        // 文本前缀匹配（如 "/report"）
        if (r.textStartsWith && !text.startsWith(r.textStartsWith)) continue;
        // 文本包含匹配
        if (r.textIncludes && !text.includes(r.textIncludes)) continue;
        
        return r.agentId; // 返回命中规则的 AgentId
    }
    return null;
}

export interface AgentConfig {
    id: string;
    displayName: string;
    systemPromptPrefix?: string;
    builtInToolAllowlist?: string[];
    permissionProfileId?: string;
}

/**
 * 获取 Agent 配置，若 ID 不合法则返回 main
 */
export function getAgentConfig(agentId: string): AgentConfig {
    return getAgentConfigById(agentId) ?? (FALLBACK_MAIN as AgentConfig);
}

/**
 * 获取该 Agent 被允许使用的工具集合
 * 返回 Set 方便在后续执行逻辑中用 .has() 快速检查
 */
export function getBuiltInToolAllowlistForAgent(agentId: string): Set<string> | null {
    const cfg = getAgentConfig(agentId);
    if (!cfg.builtInToolAllowlist || cfg.builtInToolAllowlist.length === 0) return null;
    return new Set(cfg.builtInToolAllowlist);
}

/**
 * 文本二次处理：剔除指令前缀
 * 例子：输入 "/report 帮我总结" -> 转化为 "帮我总结" 传给 AI
 */
export function normalizeTextForAgent(agentId: string, raw: string): string {
    const text = raw.trim();
    if (agentId === "frontend") {
        if (text.startsWith("/frontend")) return text.replace(/^\/frontend\s*/i, "").trim() || "请协助前端开发任务";
        if (text.startsWith("/fe")) return text.replace(/^\/fe\s*/i, "").trim() || "请协助前端开发任务";
    }
    if (agentId === "daily_report") {
        // 匹配并移除指令，如果移除后内容为空，提供默认动作描述
        if (text.startsWith("/report")) return text.replace(/^\/report\s*/i, "").trim() || "请生成今日日报";
        if (text.startsWith("/daily")) return text.replace(/^\/daily\s*/i, "").trim() || "请生成今日日报";
    }
    if (agentId === "code_review") {
        if (text.startsWith("/review")) return text.replace(/^\/review\s*/i, "").trim() || "请做代码评审";
    }
    return text;
}

/** 与 resolveAgentId 各分支对应，便于 trace / 编排归因 */
export type AgentResolveSource = "user" | "intent" | "binding" | "default";

/**
 * 解析 Agent，并附带决策分支（不改变 resolveAgentId 的语义）
 */
export function resolveAgentIdWithSource(inbound: UnifiedInboundMessage): {
    agentId: AgentId;
    source: AgentResolveSource;
} {
    if (typeof inbound.agentId === "string" && inbound.agentId.trim()) {
        const id = inbound.agentId.trim();
        return { agentId: (getAgentConfigById(id)?.id ?? "main") as AgentId, source: "user" };
    }

    const intent = normalizeIntent(inbound.intent);
    if (intent === "daily_report") return { agentId: "daily_report", source: "intent" };
    if (intent === "code_review") return { agentId: "code_review", source: "intent" };

    const byBinding = matchBinding(inbound);
    if (byBinding) {
        return { agentId: (getAgentConfigById(byBinding)?.id ?? "main") as AgentId, source: "binding" };
    }

    return { agentId: "main", source: "default" };
}

function mapResolveSourceToTrace(s: AgentResolveSource): TraceDecisionSource {
    if (s === "user") return "user";
    if (s === "binding") return "binding";
    return "default";
}

/**
 * 多 Agent 协作入口：在任务场景下优先采用「当前 running 步」的 assignedAgentId；
 * agentLocked 为 true 且用户显式传了 agentId 时，不覆盖用户选择。
 */
export function resolveEffectiveAgent(
    inbound: UnifiedInboundMessage,
    runningStep: PlanStep | null | undefined,
): { agentId: AgentId; decisionSource: TraceDecisionSource } {
    const explicit =
        typeof inbound.agentId === "string" && inbound.agentId.trim() !== ""
            ? inbound.agentId.trim()
            : undefined;

    if (inbound.agentLocked && explicit) {
        const id = getAgentConfigById(explicit)?.id ?? "main";
        return { agentId: id as AgentId, decisionSource: "user" };
    }

    const stepAgent = runningStep?.assignedAgentId?.trim();
    if (stepAgent) {
        const cfg = getAgentConfigById(stepAgent);
        if (cfg) {
            return { agentId: cfg.id as AgentId, decisionSource: "plan_step" };
        }
    }

    const { agentId, source } = resolveAgentIdWithSource(inbound);
    if (inbound.decisionSource) {
        return { agentId, decisionSource: inbound.decisionSource };
    }
    return { agentId, decisionSource: mapResolveSourceToTrace(source) };
}

/**
 * [决策中心] 决定该由哪个 Agent 响应当前的输入消息
 */
export function resolveAgentId(inbound: UnifiedInboundMessage): AgentId {
    return resolveAgentIdWithSource(inbound).agentId;
}
