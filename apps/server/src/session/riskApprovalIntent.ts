/**
 * 高风险审批：自然语言与斜杠简写（与 Web 弹窗等价，供 TUI / API 等无 UI 渠道使用）
 * 批准后注入模型的固定句见 i18n/riskApprovalMessages（随 ONECLAW_UI_LOCALE 切换）。
 */

export type RiskApprovalIntent = "approve" | "reject" | null;

export type RiskIntentContext = {
    sessionRiskPending: boolean;
    taskRiskPending: boolean;
};

/**
 * 仅在「当前确有会话级或任务级待审批」时，将短句解析为批准/拒绝。
 * 避免日常对话中的「好」误触。
 */
export function parseRiskApprovalIntent(text: string, ctx: RiskIntentContext): RiskApprovalIntent {
    const raw = text.trim();
    if (!raw) return null;

    const lower = raw.toLowerCase();

    if (/^\/approve-risk\b/i.test(raw)) {
        return ctx.sessionRiskPending ? "approve" : null;
    }
    if (/^\/task-approve\b/i.test(raw)) {
        return ctx.taskRiskPending ? "approve" : null;
    }

    if (!ctx.sessionRiskPending && !ctx.taskRiskPending) {
        return null;
    }

    if (/^(?:拒绝|否定|否|不要|算了|取消|不用)$/.test(raw)) return "reject";
    if (/^(?:no|nope|deny|reject)\b/i.test(lower)) return "reject";

    if (raw.length <= 96 && /不同意/.test(raw)) return "reject";
    if (raw.length <= 96 && /拒绝/.test(raw)) return "reject";

    if (/^(?:批准|同意|确认|通过|执行|继续)$/.test(raw)) return "approve";
    if (/^(?:ok|okay|yes|y|sure|approve)\b/i.test(lower)) return "approve";

    if (raw.length <= 64 && /^(?:好|行|嗯|可以)(?:[，,。.!！\s]*)$/.test(raw)) return "approve";
    if (raw.length <= 80 && /^(?:好的|行|嗯(?:好的)?)(?:[，,。.!！\s]*)$/.test(raw)) return "approve";
    if (raw.length <= 80 && /^(?:我)?(?:同意|批准)(?:[，,。.!！了\n]|$)/.test(raw)) return "approve";
    if (raw.length <= 48 && /^请(?:继续|执行)/.test(raw)) return "approve";

    return null;
}
