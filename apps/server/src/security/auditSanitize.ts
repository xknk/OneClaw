/**
 * 定义敏感键值的正则表达式
 * 匹配：password, token, secret, api-key, api_key, authorization, bearer (忽略大小写)
 */
const SENSITIVE_KEY = /^(password|token|secret|api[_-]?key|authorization|bearer)$/i;

/**
 * 生成可写入 trace / 审计的入参摘要
 * 
 * @param toolName - 工具/函数的名称
 * @param args - 原始输入参数对象
 * @param extraMeta - 额外需要记录的元数据
 * @returns 脱敏且截断后的参数对象
 */
export function sanitizeToolArgsForTrace(
    toolName: string,
    args: Record<string, unknown> | undefined,
    extraMeta?: Record<string, unknown>
): Record<string, unknown> {
    // 初始化返回对象，包含工具名和额外的元数据
    const meta: Record<string, unknown> = { toolName, ...extraMeta };

    // 如果没有传入参数，直接返回基础元数据
    if (!args) return meta;

    // 遍历参数对象的每一个键值对
    for (const [k, v] of Object.entries(args)) {

        // 策略 1：敏感键脱敏
        if (SENSITIVE_KEY.test(k)) {
            meta[k] = "[REDACTED]";
            continue;
        }

        // 策略 2：针对执行命令 (command) 的特殊处理
        if (k === "command" && typeof v === "string") {
            meta.commandLength = v.length; // 记录命令总长度
            // 仅保留前 120 个字符作为预览，防止日志行过长
            meta.commandPreview = v.length > 120 ? `${v.slice(0, 120)}…` : v;
            continue;
        }

        // 策略 3：针对大段内容 (content) 的特殊处理
        if (k === "content" && typeof v === "string") {
            // content 通常是文件内容或长文本，日志中通常不希望完整保存
            // 仅记录字符数，不保存原始值
            meta.contentChars = v.length;
            continue;
        }

        // 策略 4：通用字符串截断
        if (typeof v === "string") {
            // 普通字符串如果超过 200 字符则截断
            meta[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
        } else {
            // 非字符串类型（数字、布尔、嵌套对象等）原样保留
            meta[k] = v;
        }
    }

    return meta;
}
