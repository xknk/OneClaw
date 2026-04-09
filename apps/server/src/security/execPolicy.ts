/**
 * 命令参数安全策略配置
 */
export interface ExecParameterPolicyOptions {
    /** 
     * 命令字符串的最大字符长度限制。
     * 用于防止超长命令导致的缓冲区溢出攻击或资源耗尽攻击。
     */
    maxLength?: number;
    
    /** 
     * 禁止在命令中出现的敏感子串列表。
     * 通常用于阻断 Shell 注入符号，例如 [";", "&&", "||", "`", "$(", ">"] 等。
     */
    forbiddenSubstrings?: string[];
}

/**
 * 校验执行命令是否违反了参数安全规则
 * 
 * 建议调用顺序：
 * 1. 先跑本函数进行长度和黑名单子串检查。
 * 2. 再跑 profile.execAllowlistPatterns 进行精确的正向逻辑匹配（白名单）。
 * 
 * @param command 待执行的完整命令字符串
 * @param opts 校验配置选项
 * @returns {string | null} 返回 null 表示校验通过；返回 string 则为具体的拦截原因。
 */
export function execViolatesParameterRules(
    command: string,
    opts: ExecParameterPolicyOptions
): string | null {
    // 1. 长度校验：如果设置了最大长度，检查输入是否超限
    const max = opts.maxLength;
    if (typeof max === "number" && command.length > max) {
        // 这里的提示信息能够明确告知调用者是由于“过长”被拦截
        return `无权限：命令长度超出限制（>${max}）`;
    }

    // 2. 敏感子串黑名单校验
    const bad = opts.forbiddenSubstrings ?? [];
    for (const s of bad) {
        // 确保不检查空字符串（避免逻辑死循环或误判）
        if (s !== "" && command.includes(s)) {
            // 使用 JSON.stringify(s) 可以更直观地在错误信息中展示不可见字符或特殊符号
            return `无权限：命令包含禁止片段: ${JSON.stringify(s)}`;
        }
    }

    // 3. 如果以上检查均未命中，说明基础参数规则合规
    return null;
}
