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
/**
 * webchat_default 的 exec 白名单：仅匹配「整条 command 字符串」；仍受 execForbiddenSubstrings
 *（禁止 &&、||、;、`、$( 等串联/注入）与 ONECLAW_EXEC_DENIED_PATTERNS 约束。
 * 批量操作建议单条 robocopy/xcopy/forfiles，勿在一行内串联多条命令。
 */
const WEBCHAT_DEFAULT_EXEC_ALLOWLIST: RegExp[] = [
    // --- 包管理与开发 ---
    /^npm\s+run\s+/i,
    /^pnpm\s+/i,
    /^yarn\s+/i,
    /^npx\s+/i,
    /^node\b/i,
    /^git\s+/i,

    // --- Windows：直跑常用内置命令（增删改查 / 属性 / ACL）---
    /^dir\b/i,
    /^cd\b/i,
    /^chdir\b/i,
    /^mkdir\b/i,
    /^md\b/i,
    /^rmdir\b/i,
    /^rd\b/i,
    /^copy\b/i,
    /^move\b/i,
    /^xcopy\b/i,
    /^robocopy\b/i,
    /^del\b/i,
    /^erase\b/i,
    /^ren\b/i,
    /^rename\b/i,
    /^type\b/i,
    /^more\b/i,
    /^tree\b/i,
    /^where\b/i,
    /^attrib\b/i,
    /^icacls\b/i,
    /^cacls\b/i,
    /^takeown\b/i,
    /^mklink\b/i,
    /^fsutil\s+file\b/i,
    /^forfiles\b/i,

    // cmd /c 前缀：第二令牌限定为上述同类动词，避免放行任意 cmd /c
    /^cmd(?:\.exe)?\s+\/c\s+(?:dir|cd|chdir|mkdir|md|rmdir|rd|copy|move|xcopy|robocopy|del|erase|ren|rename|type|more|tree|where|attrib|icacls|cacls|takeown|mklink|forfiles)\b/i,
    /^cmd(?:\.exe)?\s+\/c\s+fsutil\s+file\b/i,

    // PowerShell：仅 -Command / -c 且正文含下列 cmdlet 之一（单行；仍禁 ; 串联）
    /^powershell(?:\.exe)?\s+(?:-\w+\s+\S+\s+)*-(?:Command|c)\s+[\s\S]{0,12000}?\b(Move-Item|Copy-Item|Remove-Item|New-Item|Get-ChildItem|Get-Item|Set-Item|Get-Content|Set-Content|Add-Content|Clear-Content|Rename-Item|Test-Path|Get-Acl|Set-Acl|Get-ItemProperty|Set-ItemProperty)\b/i,
    /^pwsh(?:\.exe)?\s+(?:-\w+\s+\S+\s+)*-(?:Command|c)\s+[\s\S]{0,12000}?\b(Move-Item|Copy-Item|Remove-Item|New-Item|Get-ChildItem|Get-Item|Set-Item|Get-Content|Set-Content|Add-Content|Clear-Content|Rename-Item|Test-Path|Get-Acl|Set-Acl|Get-ItemProperty|Set-ItemProperty)\b/i,

    // --- Unix / Git Bash 常见 ---
    /^ls\b/i,
    /^cp\b/i,
    /^mv\b/i,
    /^rm\b/i,
    /^chmod\b/i,
    /^chown\b/i,
    /^chgrp\b/i,
    /^cat\b/i,
    /^touch\b/i,
    /^ln\b/i,
    /^stat\b/i,
    /^head\b/i,
    /^tail\b/i,
    /^which\b/i,
    /^pwd\b/i,
];

const PROFILES_BASE: Record<PermissionProfileId, PermissionProfile> = {
    webchat_default: {
        allowReadWorkspace: true,
        allowWriteWorkspace: true,
        allowExec: true,
        execAllowlistPatterns: [...WEBCHAT_DEFAULT_EXEC_ALLOWLIST],
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

    if (toolName === "move_file") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止移动或重命名文件", "POLICY_MOVE_FORBIDDEN", pid);
        }
        const from = typeof args?.from === "string" ? args.from.trim() : "";
        const to = typeof args?.to === "string" ? args.to.trim() : "";
        if (!from || !to) return deny("参数错误：move_file 需要 from 与 to", "POLICY_MOVE_PATH_REQUIRED");
        for (const p of [from, to]) {
            const pv = checkPathPolicy(p, pOpt);
            if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        }
        const toIntent = validateApplyPatchDriveIntent(ctx.userText, to);
        if (!toIntent.ok) return deny(toIntent.message, toIntent.code, { ...toIntent.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "copy_file") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止复制文件到 workspace", "POLICY_COPY_FORBIDDEN", pid);
        }
        const from = typeof args?.from === "string" ? args.from.trim() : "";
        const to = typeof args?.to === "string" ? args.to.trim() : "";
        if (!from || !to) return deny("参数错误：copy_file 需要 from 与 to", "POLICY_COPY_PATH_REQUIRED");
        for (const p of [from, to]) {
            const pv = checkPathPolicy(p, pOpt);
            if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        }
        const toIntent = validateApplyPatchDriveIntent(ctx.userText, to);
        if (!toIntent.ok) return deny(toIntent.message, toIntent.code, { ...toIntent.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "make_directory") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止创建目录", "POLICY_MKDIR_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path.trim() : "";
        if (!pathArg) return deny("参数错误：make_directory 需要 path", "POLICY_MKDIR_PATH_REQUIRED");
        const pv = checkPathPolicy(pathArg, pOpt);
        if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        const pathIntent = validateApplyPatchDriveIntent(ctx.userText, pathArg);
        if (!pathIntent.ok) return deny(pathIntent.message, pathIntent.code, { ...pathIntent.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "file_stat") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止读取路径信息", "POLICY_STAT_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path : "";
        const trimmed = pathArg.trim();
        if (trimmed === "" || trimmed === ".") {
            return { allow: true };
        }
        const pv = checkPathPolicy(pathArg, pOpt);
        if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "read_file_range" || toolName === "file_hash") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止读取文件", "POLICY_READ_FILE_RANGE_FORBIDDEN", pid);
        }
        const pathArg = typeof args?.path === "string" ? args.path : "";
        if (!pathArg.trim()) {
            return deny(`参数错误：${toolName} 需要 path`, "POLICY_READ_FILE_RANGE_PATH_REQUIRED");
        }
        const pv = checkPathPolicy(pathArg, pOpt);
        if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "create_zip") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止打包 zip", "POLICY_ZIP_CREATE_FORBIDDEN", pid);
        }
        const paths = args?.paths;
        const output = typeof args?.output_path === "string" ? args.output_path.trim() : "";
        if (!Array.isArray(paths) || !paths.length) {
            return deny("参数错误：create_zip 需要非空 paths 数组", "POLICY_ZIP_PATHS_REQUIRED");
        }
        if (!output) {
            return deny("参数错误：create_zip 需要 output_path", "POLICY_ZIP_OUT_REQUIRED");
        }
        for (const p of paths) {
            if (typeof p !== "string" || !p.trim()) {
                return deny("参数错误：paths 须全部为字符串", "POLICY_ZIP_PATH_ITEM");
            }
            const pv = checkPathPolicy(p, pOpt);
            if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        }
        const pvo = checkPathPolicy(output, pOpt);
        if (pvo) return deny(pvo.message, pvo.code, { ...pvo.meta, ...pid });
        const outIntent = validateApplyPatchDriveIntent(ctx.userText, output);
        if (!outIntent.ok) return deny(outIntent.message, outIntent.code, { ...outIntent.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "extract_zip") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止解压 zip", "POLICY_ZIP_EXTRACT_FORBIDDEN", pid);
        }
        const z = typeof args?.zip_path === "string" ? args.zip_path.trim() : "";
        const t = typeof args?.target_dir === "string" ? args.target_dir.trim() : "";
        if (!z || !t) {
            return deny("参数错误：extract_zip 需要 zip_path 与 target_dir", "POLICY_ZIP_EXTRACT_PATHS");
        }
        for (const p of [z, t]) {
            const pv = checkPathPolicy(p, pOpt);
            if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        }
        const tIntent = validateApplyPatchDriveIntent(ctx.userText, t);
        if (!tIntent.ok) return deny(tIntent.message, tIntent.code, { ...tIntent.meta, ...pid });
        return { allow: true };
    }

    if (toolName === "batch_file_ops") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止批量文件操作", "POLICY_BATCH_FORBIDDEN", pid);
        }
        const ops = args?.operations;
        if (!Array.isArray(ops) || ops.length === 0) {
            return deny("参数错误：batch_file_ops 需要非空 operations 数组", "POLICY_BATCH_OPS_REQUIRED");
        }
        if (ops.length > 30) {
            return deny("参数错误：batch_file_ops 最多 30 条", "POLICY_BATCH_OPS_LIMIT");
        }
        const pathsFromItem = (item: unknown): string[] => {
            if (!item || typeof item !== "object") return [];
            const o = item as Record<string, unknown>;
            const op = typeof o.op === "string" ? o.op : "";
            if (op === "delete") {
                return typeof o.path === "string" ? [o.path] : [];
            }
            if (op === "move" || op === "copy") {
                const out: string[] = [];
                if (typeof o.from === "string") out.push(o.from);
                if (typeof o.to === "string") out.push(o.to);
                return out;
            }
            if (op === "mkdir") {
                return typeof o.path === "string" ? [o.path] : [];
            }
            return [];
        };
        for (const item of ops) {
            for (const p of pathsFromItem(item)) {
                const pv = checkPathPolicy(p, pOpt);
                if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
            }
        }
        return { allow: true };
    }

    if (toolName === "git_read") {
        if (!profile.allowReadWorkspace) {
            return deny("无权限：当前会话禁止只读 git", "POLICY_GIT_READ_FORBIDDEN", pid);
        }
        const wdRaw = typeof args?.working_directory === "string" ? args.working_directory.trim() : "";
        const wd = wdRaw === "" ? "." : wdRaw;
        if (wd !== ".") {
            const pv = checkPathPolicy(wd, pOpt);
            if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        }
        const argv = args?.args;
        if (!Array.isArray(argv) || !argv.every((x) => typeof x === "string")) {
            return deny("参数错误：git_read 需要 args 字符串数组", "POLICY_GIT_ARGS_REQUIRED");
        }
        return { allow: true };
    }

    if (toolName === "git_write") {
        if (!profile.allowWriteWorkspace) {
            return deny("无权限：当前会话禁止写入类 git", "POLICY_GIT_WRITE_FORBIDDEN", pid);
        }
        const wdRaw = typeof args?.working_directory === "string" ? args.working_directory.trim() : "";
        const wd = wdRaw === "" ? "." : wdRaw;
        if (wd !== ".") {
            const pv = checkPathPolicy(wd, pOpt);
            if (pv) return deny(pv.message, pv.code, { ...pv.meta, ...pid });
        }
        const argv = args?.args;
        if (!Array.isArray(argv) || !argv.every((x) => typeof x === "string")) {
            return deny("参数错误：git_write 需要 args 字符串数组", "POLICY_GIT_ARGS_REQUIRED");
        }
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

    if (
        toolName === "fetch_url" ||
        toolName === "http_request" ||
        toolName === "fetch_readable" ||
        toolName === "fetch_feed" ||
        toolName === "web_search"
    ) {
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

    if (toolName === "dns_resolve") {
        if (ctx.profileId === "qq_group") {
            return deny("无权限：QQ 渠道不允许 dns_resolve", "POLICY_DNS_QQ_FORBIDDEN", pid);
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