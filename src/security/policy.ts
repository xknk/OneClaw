import { getAgentConfig } from "@/agent/agentRegistry";

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
    | "daily_report"

/**
 * 策略上下文：记录当前请求的来源、身份及匹配的权限组
 */
export interface PolicyContext {
    channelId: string;   // 渠道标识 (e.g., 'webchat', 'qq')
    sessionKey: string;  // 会话唯一标识
    agentId: string;     // Agent 实例 ID
    profileId: PermissionProfileId; // 当前生效的权限配置 ID
}

/**
 * 权限配置详细项
 */
interface PermissionProfile {
    allowReadWorkspace: boolean;      // 是否允许读取文件 (read_file, search_files)
    allowWriteWorkspace: boolean;     // 是否允许修改文件 (apply_patch)
    allowExec: boolean;               // 是否允许执行终端命令 (exec)
    execAllowlistPatterns?: RegExp[]; // 命令执行的正则表达式白名单
}

/**
 * 静态定义的权限模板库
 */
const PROFILES: Record<PermissionProfileId, PermissionProfile> = {
    // 网页端：通常是开发者本人使用，权限较宽
    webchat_default: {
        allowReadWorkspace: true, // 网页端默认允许读取 workspace 内的所有文件
        allowWriteWorkspace: true, // 网页端默认允许写入 workspace 内的所有文件
        allowExec: true, // 网页端默认允许执行任何命令
        // 限制 exec 只能运行安全的构建或查看类命令
        execAllowlistPatterns: [
            /^npm\s+run\s+/i,               // 允许 npm run xxx
            /^pnpm\s+/i,                    // 允许 pnpm 命令
            /^node\s+/i,                    // 允许运行 node 脚本
            /^git\s+(status|diff|log)\b/i,  // 允许 git 只读操作
            /^dir\b/i,                      // 允许查看目录 (Windows)
        ],
    },
    // QQ 群：环境复杂，关闭写权限和执行权限，防止删库或泄露隐私
    qq_group: {
        allowReadWorkspace: true, // QQ 群环境允许读取 workspace 内的所有文件
        allowWriteWorkspace: false, // QQ 群环境不允许写入任何文件
        allowExec: false, // QQ 群环境不允许执行任何命令
    },
    // 极端安全模式：仅可读
    readonly: {
        allowReadWorkspace: true, // 极端安全模式下允许读取 workspace 内的所有文件
        allowWriteWorkspace: false, // 极端安全模式下不允许写入任何文件
        allowExec: false, // 极端安全模式下不允许执行任何命令
    },
    daily_report: {
        allowReadWorkspace: true, // 日报 Agent 需要读取 workspace 来生成报告文件
        allowWriteWorkspace: true, // 日报 Agent 需要写权限来生成报告文件
        allowExec: false,          // 但不需要也不允许执行系统命令
    },
};

/**
 * 路由函数：根据渠道信息决定该会话使用哪套权限模板
 * channelId 渠道标识
 * agentId Agent 实例 ID, 默认为 main
 * 返回权限配置 ID
 */
export function resolveProfileId(params: {
    channelId: string;
    agentId?: string;
}): PermissionProfileId {
    const cfg = getAgentConfig(params.agentId ?? "main");
    // 如果配置了权限配置 ID，则返回权限配置 ID
    if (cfg.permissionProfileId) {
        return cfg.permissionProfileId as PermissionProfileId;
    }
    // 如果渠道标识为 QQ，则返回 QQ 群权限配置 ID
    if (params.channelId === "qq") return "qq_group";
    // 否则返回网页端默认权限配置 ID
    return "webchat_default";
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
    const profile = PROFILES[ctx.profileId];
    if (!profile) return "无权限：未知权限配置";

    // 1. 检查读取相关工具 (MCP read_file / search_files)
    if (toolName === "read_file" || toolName === "search_files") {
        return profile.allowReadWorkspace ? null : "无权限：当前会话禁止读取 workspace";
    }

    // 2. 检查写入相关工具 (MCP apply_patch)
    if (toolName === "apply_patch") {
        return profile.allowWriteWorkspace ? null : "无权限：当前会话禁止写入 workspace";
    }

    // 3. 检查命令执行工具 (MCP exec)
    if (toolName === "exec") {
        // 首先检查是否总开关允许执行
        if (!profile.allowExec) {
            return "无权限：当前会话禁止执行命令";
        }

        const command = typeof args?.command === "string" ? args.command.trim() : "";
        if (!command) return "参数错误：exec 需要 command 参数";

        // 其次检查命令内容是否符合正则表达式白名单
        const allowlist = profile.execAllowlistPatterns ?? [];
        if (allowlist.length > 0) {
            const matched = allowlist.some((re) => re.test(command));
            if (!matched) return `无权限：命令不在 allowlist 中: ${command}`;
        }
    }

    // 默认放行其他不在管控范围内的工具
    return null;
}
