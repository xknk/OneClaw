import { getAgentConfig } from "@/agent/agentRegistry";
import { appConfig } from "@/config/evn";
import { checkPathPolicy } from "@/security/pathPolicy";
import type { ToolGuardResult } from "@/security/toolGuard";
import { mergeProfileOverride, readPolicyOverridesFile } from "@/security/policyOverrides";

/**
 * 权限配置文件 ID 类型
 * webchat_default: 网页端默认（高权限）
 * qq_group: QQ 群环境（受限权限）
 * readonly: 只读模式
 */
export type PermissionProfileId =
    | "webchat_default"
    | "qq_group"
    | "readonly"
    | "daily_report";

/**
 * 策略上下文：记录当前请求的来源、身份及匹配的权限组
 */
export interface PolicyContext {
    channelId: string; // 渠道ID
    sessionKey: string; // 会话ID
    agentId: string; // 代理ID
    profileId: PermissionProfileId; // 权限配置文件ID
    /** 当前用户输入原文（用于意图约束，如“写到 D 盘”） */
    userText?: string;
}
/**
 * 权限配置文件
 */
interface PermissionProfile {
    allowReadWorkspace: boolean; // 允许读取工作空间
    allowWriteWorkspace: boolean; // 允许写入工作空间
    allowExec: boolean; // 允许执行命令
    execAllowlistPatterns?: RegExp[];
    pathAllowlistPrefixes?: string[]; // 允许访问的前缀列表
    pathDenylistPatterns?: RegExp[]; // 禁止访问的正则模式列表
    execMaxCommandLength?: number;
    execForbiddenSubstrings?: string[]; // 禁止执行的命令片段       
}
 /**
  * 敏感路径黑名单
  */
const SENSITIVE_PATH_DENY: RegExp[] = [
    /\.env$/i,
    /^\.env\./i,
    /(^|\/)secrets(\/|$)/i,
    /(^|\/)credentials(\/|$)/i,
    /\.pem$/i,
    /(^|\/)\.ssh(\/|$)/i,
];
/**
 * 默认禁止执行的命令片段
 */
const DEFAULT_EXEC_FORBIDDEN: string[] = ["&&", "||", ";", "`", "$(", "${", "\n"];
function cloneProfile(p: PermissionProfile): PermissionProfile {
    return {
        ...p,
        execAllowlistPatterns: p.execAllowlistPatterns ? [...p.execAllowlistPatterns] : undefined,
        pathAllowlistPrefixes: p.pathAllowlistPrefixes ? [...p.pathAllowlistPrefixes] : undefined,
        pathDenylistPatterns: p.pathDenylistPatterns ? [...p.pathDenylistPatterns] : undefined,
        execForbiddenSubstrings: p.execForbiddenSubstrings ? [...p.execForbiddenSubstrings] : undefined,
    };
}

/**
 * 内置权限表（可被 dataDir/policy-overrides.json 合并覆盖）
 */
const PROFILES_BASE: Record<PermissionProfileId, PermissionProfile> = {
    webchat_default: {
        allowReadWorkspace: true,
        allowWriteWorkspace: true,
        allowExec: true,
        execAllowlistPatterns: [
            /^npm\s+run\s+/i,
            /^pnpm\s+/i,
            /^node\s+/i,
            /^git\s+(status|diff|log)\b/i,
            /^dir\b/i,
        ],
        pathDenylistPatterns: SENSITIVE_PATH_DENY,
        execMaxCommandLength: 16_000,
        execForbiddenSubstrings: DEFAULT_EXEC_FORBIDDEN,
    },
    qq_group: {
        allowReadWorkspace: true,
        allowWriteWorkspace: false,
        allowExec: false,
        pathDenylistPatterns: SENSITIVE_PATH_DENY,
    },
    readonly: {
        allowReadWorkspace: true,
        allowWriteWorkspace: false,
        allowExec: false,
        pathDenylistPatterns: SENSITIVE_PATH_DENY,
    },
    daily_report: {
        allowReadWorkspace: true,
        allowWriteWorkspace: true,
        allowExec: false,
        pathDenylistPatterns: SENSITIVE_PATH_DENY,
    },
};

function buildProfiles(): Record<PermissionProfileId, PermissionProfile> {
    const out: Record<PermissionProfileId, PermissionProfile> = {
        webchat_default: cloneProfile(PROFILES_BASE.webchat_default),
        qq_group: cloneProfile(PROFILES_BASE.qq_group),
        readonly: cloneProfile(PROFILES_BASE.readonly),
        daily_report: cloneProfile(PROFILES_BASE.daily_report),
    };
    const file = readPolicyOverridesFile();
    if (!file?.profiles) return out;
    const ids: PermissionProfileId[] = ["webchat_default", "qq_group", "readonly", "daily_report"];
    for (const id of ids) {
        const o = file.profiles[id];
        if (o) out[id] = mergeProfileOverride(out[id], o);
    }
    return out;
}

const PROFILES: Record<PermissionProfileId, PermissionProfile> = buildProfiles();

/**
 * 根据渠道ID和代理ID解析权限配置文件ID
 */
export function resolveProfileId(params: { channelId: string; agentId?: string }): PermissionProfileId {
    const cfg = getAgentConfig(params.agentId ?? "main"); // 获取代理配置
    if (cfg.permissionProfileId) {
        return cfg.permissionProfileId as PermissionProfileId;
    }
    if (params.channelId === "qq") return "qq_group"; // 如果渠道ID为QQ，则返回QQ群权限配置文件ID       
    return "webchat_default"; // 否则返回网页端默认权限配置文件ID
}

/**
 * 根据权限配置文件生成路径策略配置
 */
function pathPolicyFor(profile: PermissionProfile): {
    allowlistPrefixes?: string[];
    denylistPatterns?: RegExp[];
} {
    return {
        allowlistPrefixes: profile.pathAllowlistPrefixes, // 允许访问的前缀列表
        denylistPatterns: profile.pathDenylistPatterns, // 禁止访问的正则模式列表
    };
}

/**
 * 生成拒绝结果
 */
function deny(message: string, code: string, auditMeta?: Record<string, unknown>): ToolGuardResult {
    return { allow: false, message, errorCode: code, auditMeta };
}

function detectRequestedWindowsDrive(text: string | undefined): string | null {
    if (!text) return null;
    const byChineseDrive = text.match(/([a-zA-Z])盘/);
    if (byChineseDrive?.[1]) return byChineseDrive[1].toUpperCase();
    const byAbsPath = text.match(/\b([a-zA-Z]):[\\/]/);
    if (byAbsPath?.[1]) return byAbsPath[1].toUpperCase();
    return null;
}

function validateApplyPatchDriveIntent(
    userText: string | undefined,
    pathArg: string,
): { ok: true } | { ok: false; message: string; code: string; meta: Record<string, unknown> } {
    const expectedDrive = detectRequestedWindowsDrive(userText);
    if (!expectedDrive) return { ok: true };

    const m = pathArg.match(/^([a-zA-Z]):[\\/]/);
    if (!m?.[1]) {
        return {
            ok: false,
            code: "POLICY_WRITE_PATH_ABSOLUTE_REQUIRED",
            message: `参数错误：你要求写入 ${expectedDrive}: 盘，path 必须是该盘绝对路径（如 ${expectedDrive}:\\\\time.txt）。`,
            meta: { expectedDrive, path: pathArg },
        };
    }
    const actualDrive = m[1].toUpperCase();
    if (actualDrive !== expectedDrive) {
        return {
            ok: false,
            code: "POLICY_WRITE_PATH_DRIVE_MISMATCH",
            message: `参数错误：你要求写入 ${expectedDrive}: 盘，但当前 path 位于 ${actualDrive}: 盘（${pathArg}）。`,
            meta: { expectedDrive, actualDrive, path: pathArg },
        };
    }
    return { ok: true };
}

/** exec：长度与禁止子串（与 execPolicy 行为一致，附带 errorCode） */
function checkExecArgsPolicy(
    command: string,
    profile: PermissionProfile
): ToolGuardResult | null {
    const max = profile.execMaxCommandLength;
    if (typeof max === "number" && command.length > max) {
        return deny(
            `无权限：命令长度超出限制（>${max}）`,
            "POLICY_EXEC_LENGTH",
            { length: command.length, max, permissionProfileId: undefined }
        );
    }
    const bad = profile.execForbiddenSubstrings ?? [];
    for (const s of bad) {
        if (s !== "" && command.includes(s)) {
            return deny(
                `无权限：命令包含禁止片段: ${JSON.stringify(s)}`,
                "POLICY_EXEC_FORBIDDEN_SUBSTRING",
                { fragment: s }
            );
        }
    }
    return null;
}

function isLikelyFileMutationCommand(command: string): boolean {
    const c = command.trim().toLowerCase();
    return /^(mkdir|md|new-item)\b/.test(c)
        || /\>\s*[^|]+$/.test(c)
        || /^(copy|move|ren|rename|del|erase|rmdir|rd)\b/.test(c);
}

/**
 * 结构化策略结果（供执行层写 trace：errorCode / auditMeta）
 */
export function evaluateToolPermission(
    ctx: PolicyContext,
    toolName: string,
    args?: Record<string, unknown>
): ToolGuardResult {
    const profile = PROFILES[ctx.profileId];
    if (!profile) {
        return deny("无权限：未知权限配置", "POLICY_UNKNOWN_PROFILE", { profileId: ctx.profileId });
    }

    const pOpt = pathPolicyFor(profile);
    const pid = { permissionProfileId: ctx.profileId };

    if (toolName === "read_file") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止读取 workspace", "POLICY_READ_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path : "";
        if (!pathArg.trim()) return deny("参数错误：read_file 需要 path", "POLICY_READ_PATH_REQUIRED");
        const v = checkPathPolicy(pathArg, pOpt);
        if (v) return deny(v.message, v.code, { ...v.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "list_directory") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止列出 workspace 目录", "POLICY_LIST_DIR_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path : "";
        const trimmed = pathArg.trim();
        if (trimmed === "" || trimmed === ".") {
            return { allow: true };
        }
        const v = checkPathPolicy(pathArg, pOpt);
        if (v) return deny(v.message, v.code, { ...v.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "apply_patch") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止写入 workspace", "POLICY_WRITE_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path : "";
        if (!pathArg.trim()) return deny("参数错误：apply_patch 需要 path", "POLICY_WRITE_PATH_REQUIRED");
        const pathIntent = validateApplyPatchDriveIntent(ctx.userText, pathArg.trim());
        if (!pathIntent.ok) {
            return deny(pathIntent.message, pathIntent.code, { ...pathIntent.meta, ...pid });
        }
        const v = checkPathPolicy(pathArg, pOpt);
        if (v) return deny(v.message, v.code, { ...v.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "delete_file") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止删除 workspace 文件", "POLICY_DELETE_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path : "";
        if (!pathArg.trim()) return deny("参数错误：delete_file 需要 path", "POLICY_DELETE_PATH_REQUIRED");
        const v = checkPathPolicy(pathArg, pOpt);
        if (v) return deny(v.message, v.code, { ...v.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "search_files") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止读取 workspace", "POLICY_SEARCH_FORBIDDEN", pid);
        }
        const glob = typeof args?.glob === "string" ? args.glob : "**/*";
        if (glob.includes("..")) {
            return deny("无权限：search_files 的 glob 不允许包含 ..", "POLICY_SEARCH_GLOB_DOTDOT");
        }
        if ((pOpt.denylistPatterns?.length ?? 0) > 0) {
            for (let i = 0; i < (pOpt.denylistPatterns ?? []).length; i++) {
                const re = pOpt.denylistPatterns![i];
                if (re.test(glob)) {
                    return deny(
                        `无权限：search_files glob 命中 denylist（规则 #${i + 1}）`,
                        "POLICY_SEARCH_GLOB_DENYLIST",
                        { ruleIndex: i + 1, ...pid }
                    );
                }
            }
        }
        return { allow: true };
    }

    if (toolName === "fetch_url" || toolName === "http_request") {
        if (!appConfig.fetchUrlEnabled) {
            return deny(
                "无权限：出站 HTTP 工具已在环境中关闭（ONECLAW_FETCH_URL_ENABLED）",
                "POLICY_FETCH_DISABLED",
                pid
            );
        }
        if (ctx.profileId === "qq_group") {
            return deny("无权限：QQ 渠道不允许使用出站 HTTP 工具", "POLICY_FETCH_QQ_FORBIDDEN", pid);
        }
        return { allow: true };
    }

    if (toolName === "generate_daily_report") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止读取 workspace", "POLICY_REPORT_READ_FORBIDDEN", pid);
        }
        const outputPath = typeof args?.outputPath === "string" ? args.outputPath : undefined;
        if (outputPath !== undefined && outputPath.trim() !== "") {
            if (!profile.allowWriteWorkspace) {
                return deny("无权限：当前会话禁止写入 workspace", "POLICY_REPORT_WRITE_FORBIDDEN", pid);
            }
            const v = checkPathPolicy(outputPath, pOpt);
            if (v) return deny(v.message, v.code, { ...v.meta, ...pid });
        }
        return { allow: true };
    }

    if (toolName === "exec") {
        if (!profile.allowExec) {
            return deny("无权限：当前会话禁止执行命令", "POLICY_EXEC_FORBIDDEN", pid);
        }
        const command = typeof args?.command === "string" ? args.command.trim() : "";
        if (!command) return deny("参数错误：exec 需要 command 参数", "POLICY_EXEC_COMMAND_REQUIRED");

        const paramDeny = checkExecArgsPolicy(command, profile);
        if (paramDeny?.allow === false) {
            const m = paramDeny.auditMeta ?? {};
            return deny(paramDeny.message, paramDeny.errorCode, { ...m, ...pid });
        }
        const allowlist = profile.execAllowlistPatterns ?? [];
        if (allowlist.length > 0) {
            const matched = allowlist.some((re) => re.test(command));
            if (!matched) {
                if (isLikelyFileMutationCommand(command)) {
                    return deny(
                        "无权限：检测到文件/目录变更命令，请改用 apply_patch 工具；若目标在 D 盘，请传绝对路径（如 D:\\time.txt）。",
                        "POLICY_EXEC_FILE_OP_USE_APPLY_PATCH",
                        { permissionProfileId: ctx.profileId, commandSample: command.slice(0, 120) }
                    );
                }
                return deny(
                    `无权限：命令不在 allowlist 中: ${command}`,
                    "POLICY_EXEC_ALLOWLIST",
                    { permissionProfileId: ctx.profileId }
                );
            }
        }
    }

    return { allow: true };
}

/**
 * 核心鉴权函数：在 Tool 调用前进行拦截检查
 * @returns string | null 返回错误信息表示无权访问，返回 null 表示校验通过
 */
export function checkToolPermission(
    ctx: PolicyContext,
    toolName: string,
    args?: Record<string, unknown>
): string | null {
    const r = evaluateToolPermission(ctx, toolName, args);
    return r.allow ? null : r.message;
}