import path from "node:path";

/**
 * 规范化工作空间相对路径
 * 目标：统一格式并彻底杜绝路径穿越（Directory Traversal）
 */
export function normalizeRelativeWorkspacePath(input: string): string {
    // 1. 统一将 Windows 的反斜杠 \ 替换为正斜杠 /，并去除首尾空格
    const s = input.trim().replace(/\\/g, "/");
    // 2. 使用 posix 规范化路径（合并重复斜杠、解析中间的 . 等）
    const norm = path.posix.normalize(s);
    
    // 如果是空路径或当前目录，返回空字符串（代表根目录）
    if (norm === "" || norm === ".") return "";
    
    // 3. 安全核心：如果路径尝试向上级目录跳跃（包含 ..），直接判定为非法，返回空
    if (norm === ".." || norm.startsWith("../") || norm.includes("/../")) {
        return "";
    }
    return norm;
}

/**
 * 路径策略配置项
 */
export interface PathPolicyOptions {
    /** 允许访问的前缀列表（白名单）。若为空，则默认允许所有合法路径 */
    allowlistPrefixes?: string[];
    /** 禁止访问的正则模式列表（黑名单）。例如：[/\.env$/, /\.git\//] */
    denylistPatterns?: RegExp[];
}

/**
 * 路径策略违规结构
 */
export type PathPolicyViolation = {
    code: "POLICY_PATH_INVALID" | "POLICY_PATH_DENYLIST" | "POLICY_PATH_ALLOWLIST";
    message: string;
    meta?: Record<string, unknown>;
};

/**
 * 核心校验函数：检查相对路径是否符合安全策略
 */
export function checkPathPolicy(relativePath: string, opts: PathPolicyOptions): PathPolicyViolation | null {
    // 1. 先进行规范化处理
    const norm = normalizeRelativeWorkspacePath(relativePath);
    
    // 如果规范化后结果为空（说明输入了非法字符或尝试路径穿越）
    if (!norm) {
        return {
            code: "POLICY_PATH_INVALID",
            message: "参数错误：路径非法或包含越界片段（..）",
        };
    }

    // 2. 黑名单校验：检查路径是否命中了任何禁止访问的正则模式
    const deny = opts.denylistPatterns ?? [];
    for (let i = 0; i < deny.length; i++) {
        if (deny[i].test(norm)) {
            return {
                code: "POLICY_PATH_DENYLIST",
                message: `无权限：路径命中 denylist（规则 #${i + 1}）`,
                meta: { ruleIndex: i + 1, pathNorm: norm },
            };
        }
    }

    // 3. 白名单校验：如果配置了白名单，路径必须匹配其中之一
    const allow = opts.allowlistPrefixes;
    if (allow && allow.length > 0) {
        let matched = false;
        for (const raw of allow) {
            // 清理白名单条目里的斜杠，确保匹配的一致性
            const p = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
            if (p === "") continue;
            
            // 匹配条件：路径完全等于白名单目录，或是白名单目录的子路径（以 p/ 开头）
            matched = norm === p || norm.startsWith(`${p}/`);
            if (matched) break;
        }
        
        if (!matched) {
            return {
                code: "POLICY_PATH_ALLOWLIST",
                message: `无权限：路径不在 path allowlist 内: ${norm}`,
                meta: { pathNorm: norm },
            };
        }
    }

    // 校验通过
    return null;
}

/**
 * 简化版校验函数：仅返回错误消息字符串
 */
export function pathViolatesPolicy(relativePath: string, opts: PathPolicyOptions): string | null {
    return checkPathPolicy(relativePath, opts)?.message ?? null;
}
