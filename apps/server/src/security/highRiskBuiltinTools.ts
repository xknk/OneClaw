/**
 * 内置「高危」工具名：与 taskApproval.requiresTaskRiskApproval 使用的集合一致，
 * 供会话级审批充值、拦截逻辑复用。若将来改为配置驱动，应集中改此处或从配置注入。
 */
export const HIGH_RISK_BUILTIN_TOOL_NAMES = [
    "exec",
    "apply_patch",
    "delete_file",
    "move_file",
    "copy_file",
    "make_directory",
    "batch_file_ops",
    "git_write",
    "create_zip",
    "extract_zip",
] as const;

export type HighRiskBuiltinToolName = (typeof HIGH_RISK_BUILTIN_TOOL_NAMES)[number];

export function isHighRiskBuiltinToolName(toolName: string): boolean {
    return (HIGH_RISK_BUILTIN_TOOL_NAMES as readonly string[]).includes(toolName);
}
