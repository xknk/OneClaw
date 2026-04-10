/**
 * V4 M3：高风险工具拦截与审批闸门
 * 作用：在工具执行层增加一层人工校验，防止 AI 自动执行危险指令（如 rm -rf /）。
 */
import { appConfig } from "@/config/evn";
import type { ToolRiskLevel } from "@/tools/types";
import {
    META_LAST_APPROVAL_KEY,
    META_APPROVAL_GRANTS_KEY,
    META_PENDING_APPROVAL_KEY,
    type TaskApprovalGrants,
} from "./collaborationTypes";
import type { TaskRecord } from "./types";
import { readTask, writeTask } from "./taskStore";
import { transitionTask } from "./taskService";

/** 定义哪些工具是高风险的：exec、apply_patch、delete_file */
const HIGH_RISK_TOOLS = new Set(["exec", "apply_patch", "delete_file"]);

/**
 * 判断工具是否需要任务风险审批
 * @param toolName 工具名称
 * @param riskLevel 工具风险等级
 * @returns 是否需要任务风险审批
 */
function requiresTaskRiskApproval(toolName: string, riskLevel?: ToolRiskLevel): boolean {
    if (riskLevel === "high") return true;
    return HIGH_RISK_TOOLS.has(toolName);
}
/** 格式化工具参数摘要，防止日志或错误信息过长 (截断为 480 字符) */
function summarizeArgs(args: Record<string, unknown> | undefined): string {
    try {
        const s = JSON.stringify(args ?? {});
        return s.length > 480 ? `${s.slice(0, 480)}…` : s;
    } catch {
        return "(args 不可序列化)";
    }
}

/** 获取当前时间戳（ISO 格式） */
function nowIso(): string {
    return new Date().toISOString();
}
/** 读取已批准的高风险工具名集合 */
function readGrantedToolNames(meta: Record<string, unknown> | undefined): Set<string> {
    const out = new Set<string>();
    const raw = meta?.[META_APPROVAL_GRANTS_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const names = (raw as TaskApprovalGrants).toolNames;
    if (!Array.isArray(names)) return out;
    for (const n of names) {
        if (typeof n === "string" && n.trim()) out.add(n.trim());
    }
    return out;
}
/**
 * 【核心拦截函数】在工具实际执行前调用
 * 返回：string (拦截信息，直接回传给模型) 或 null (通过，允许执行)
 */
export async function interceptHighRiskToolForTask(opts: {
    riskLevel: ToolRiskLevel | undefined;
    taskId: string | undefined;
    toolName: string;
    args: Record<string, unknown> | undefined;
    traceId: string;
}): Promise<string | null> {
    // 1. 前置检查：如果没有任务上下文、未开启审批功能、或不是高风险工具，直接放行
    if (!opts.taskId?.trim()) return null;
    if (!appConfig.taskHighRiskApprovalEnabled) return null;
    if (!requiresTaskRiskApproval(opts.toolName, opts.riskLevel)) return null;

    const taskId = opts.taskId.trim();
    const t = await readTask(taskId);
    if (!t) return null;

    // 2. 状态检查：如果任务已经是“待审批”状态，说明这是模型在未获批前的重复请求，直接拒绝
    if (t.status === "pending_approval") {
        const summary = summarizeArgs(opts.args);
        return (
            `无权限（待审批）：任务 ${taskId} 当前为 pending_approval。` +
            `请先调用批准接口后再重试工具「${opts.toolName}-${summary}」。`
        );
    }

    // 3. 拦截逻辑：只有正在运行的任务遇到高风险工具才触发拦截
    if (t.status !== "running") return null;
    if (readGrantedToolNames(t.meta).has(opts.toolName)) return null;

    const at = nowIso();
    const argsSummary = summarizeArgs(opts.args);
    const rollbackHint = "批准后可在同一会话中再次调用同一工具；若放弃可取消任务。";
    
    // 构造挂起的快照数据，存入 meta 供前端展示
    const pendingPayload = {
        toolName: opts.toolName,
        argsSummary,
        traceId: opts.traceId,
        requestedAt: at,
        impactScope: `本任务上下文内执行；工具=${opts.toolName}`,
        rollbackHint,
    };

    // 更新任务：保存挂起信息
    await writeTask({
        ...t,
        updatedAt: at,
        meta: { ...(t.meta ?? {}), [META_PENDING_APPROVAL_KEY]: pendingPayload },
    });

    // 4. 驱动状态机流转到“待审批”
    await transitionTask(taskId, {
        to: "pending_approval",
        reason: `high_risk_tool:${opts.toolName}`,
        timelineNote: `待审批：${opts.toolName} ${argsSummary.slice(0, 160)}`,
    });

    // 5. 返回给 LLM 的错误提示：告知模型任务已挂起，它现在应该停止动作，等待用户确认
    return (
        `【已拦截 · 待人工审批】工具「${opts.toolName}」为高风险操作，状态已设为 pending_approval。\n` +
        `动作摘要：${argsSummary}\n` +
        `请让用户调用：POST /api/tasks/${taskId}/approve 批准后再重试。`
    );
}

/**
 * 【人工入口】当用户在界面点击“允许执行”时调用
 */
export async function approvePendingTask(taskId: string, comment?: string): Promise<TaskRecord> {
    const cur = await readTask(taskId.trim());
    if (!cur) throw new Error("任务不存在");
    if (cur.status !== "pending_approval") {
        throw new Error("仅 pending_approval 状态可批准恢复为 running");
    }

    const at = nowIso(); // 当前时间戳（ISO 格式）
    const pending = cur.meta?.[META_PENDING_APPROVAL_KEY]; // 待审批快照

    let grantedTool: string | undefined; // 已批准的高风险工具名
    if (pending && typeof pending === "object" && !Array.isArray(pending)) {
        const tn = (pending as { toolName?: unknown }).toolName;
        if (typeof tn === "string" && tn.trim()) grantedTool = tn.trim();
    }
    
    // 清理“待审批”快照，转存入“最后一次审批记录”
    const meta: Record<string, unknown> = { ...(cur.meta ?? {}) };
    delete meta[META_PENDING_APPROVAL_KEY]; // 清理“待审批”快照
    // 存入“最后一次审批记录”
    meta[META_LAST_APPROVAL_KEY] = {
        approvedAt: at,
        comment: comment?.trim() || undefined,
        clearedPending: pending,
    };
    // 存入“已批准的高风险工具名”
    if (grantedTool) {
        const names = readGrantedToolNames(meta); // 获取已批准的高风险工具名集合
        names.add(grantedTool); // 添加已批准的高风险工具名
        meta[META_APPROVAL_GRANTS_KEY] = {
            toolNames: [...names], // 更新已批准的高风险工具名集合
            updatedAt: at, // 更新时间
        } satisfies TaskApprovalGrants; // 更新已批准的高风险工具名集合
    }
    // 更新任务
    await writeTask({ ...cur, meta, updatedAt: at });

    // 状态变回 running，此时模型再次请求该工具时，由于状态已变，拦截逻辑将通过
    return transitionTask(taskId.trim(), {
        to: "running",
        reason: "human_approved_high_risk",
        timelineNote: comment?.trim() ? `人工批准：${comment.trim()}` : "人工批准，恢复执行",
    });
}



