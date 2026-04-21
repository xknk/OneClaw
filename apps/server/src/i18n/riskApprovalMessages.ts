/**
 * 高风险审批相关文案：随 ONECLAW_UI_LOCALE / appConfig.uiLocale 切换，与 Web messages 中英语义对齐。
 */
import type { UiLocale } from "@/config/evn";

/** 与 Web `chat.riskApproveContinueUser` 中英一致 */
export function riskSessionApproveContinueUser(locale: UiLocale): string {
    if (locale === "en") {
        return "(User approved the high-risk action in the UI.) Please invoke the blocked tool again immediately to complete the request.";
    }
    return "（用户已在界面批准高风险操作）请立即再次调用刚才被拦截的工具以完成请求。";
}

export function riskTaskApproveContinueUser(locale: UiLocale): string {
    if (locale === "en") {
        return "(User approved this task's high-risk action.) Please invoke the blocked tool again immediately to continue the task.";
    }
    return "（用户已批准本任务的高风险操作）请立即再次调用刚才被拦截的工具以继续任务。";
}

export function riskRejectSessionReply(locale: UiLocale): string {
    if (locale === "en") {
        return "High-risk confirmation was cancelled; no tool ran. You can continue the conversation.";
    }
    return "已取消本次高风险确认，未执行工具。可继续正常提问。";
}

export function riskRejectTaskReply(locale: UiLocale, taskId: string): string {
    if (locale === "en") {
        return `Decline recorded. Task ${taskId} is still pending approval. Reply "approve" or "yes" to change your mind, or cancel via: pnpm cli task cancel ${taskId}`;
    }
    return `已记录你的拒绝。任务 ${taskId} 仍为「待审批」。若改变主意可再回复「同意」或「批准」；若需取消任务请使用：pnpm cli task cancel ${taskId}`;
}

export function interceptMissingSessionKey(locale: UiLocale, toolName: string): string {
    if (locale === "en") {
        return `[Pending confirmation] Tool "${toolName}" requires human approval, but sessionKey is missing; approval cannot be recorded.`;
    }
    return `【已拦截 · 待确认】工具「${toolName}」需要人工确认，但缺少 sessionKey，无法挂起审批。`;
}

export function interceptSessionAwaitingApproval(locale: UiLocale, toolName: string): string {
    if (locale === "en") {
        return (
            `[Pending confirmation] Tool "${toolName}" is high-risk. Web: use the approval dialog. ` +
            `TUI: use the menu at the bottom (arrow keys + Enter); do not type approve/yes in the input box. ` +
            `Optional: **/approve-risk**. One approval applies to this pending tool only (configurable burst).`
        );
    }
    return (
        `【已拦截 · 待确认】工具「${toolName}」为高风险操作。Web 端在弹窗点「批准」。` +
        `**终端 TUI：请用屏幕下方「高风险操作需要确认」菜单，↑↓ 选择后按 Enter，无需在输入框里手打「同意」；**` +
        `备用：可发 **/approve-risk**。默认每次批准仅放行当前挂起的工具；其它敏感工具下次仍会拦截。仅在未出现菜单时再在输入框输入「同意」等。`
    );
}

export function interceptTaskWhilePending(locale: UiLocale, taskId: string, toolName: string, summary: string): string {
    if (locale === "en") {
        return `Not allowed (pending approval): task ${taskId} is pending_approval. Approve on Web, send /task-approve in TUI with --task, or call the API, then retry tool "${toolName}" (${summary}).`;
    }
    return (
        `无权限（待审批）：任务 ${taskId} 当前为 pending_approval。` +
        `请在 Web 页批准、TUI 发 /task-approve，或调用接口后再重试工具「${toolName}-${summary}」。`
    );
}

export function interceptTaskMovedToPending(
    locale: UiLocale,
    taskId: string,
    toolName: string,
    argsSummary: string,
): string {
    if (locale === "en") {
        return (
            `[Blocked · human approval] Tool "${toolName}" is high-risk; task is set to pending_approval.\n` +
            `Summary: ${argsSummary}\n` +
            `Confirm in the Web chat dialog, or in TUI send /task-approve (requires --task ${taskId}), or POST /api/tasks/${taskId}/approve, then ask the model to retry.`
        );
    }
    return (
        `【已拦截 · 待人工审批】工具「${toolName}」为高风险操作，状态已设为 pending_approval。\n` +
        `动作摘要：${argsSummary}\n` +
        `请在 Web 聊天页弹窗确认，**或在本机终端 TUI 发送** \`/task-approve\` **（须已用** \`--task ${taskId}\` **启动）**，` +
        `或调用 POST /api/tasks/${taskId}/approve 后再让模型重试。`
    );
}
