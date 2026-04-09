/**
 * 工具执行前权限守卫的统一返回结构
 * 用于在权限策略层（Policy Layer）与工具执行层（Service Layer）之间传递校验结果。
 */
export type ToolGuardResult =
    // 校验通过：允许执行

    | { allow: true }
    // 校验失败：禁止执行，并提供详细的拒绝信息
    | { 
        allow: false; 
        message: string;          // 展示给用户或模型的可读错误描述
        errorCode: string;        // 机器可读的错误码（如 'POLICY_DENY', 'AUTH_FAILED'）
        auditMeta?: Record<string, unknown> // 可选：用于审计日志的额外上下文（如命中的规则 ID、时间戳等）
      };

/**
 * 结果归一化函数：兼容多种风格的权限返回格式
 * 
 * 它可以处理以下三种情况：
 * 1. 旧版风格：返回 null/undefined (通过) 或 string (失败原因)
 * 2. 结构化风格：直接返回符合 ToolGuardResult 接口的对象
 * 3. 异常情况：返回非预期格式时进行兜底处理
 * 
 * @param r 原始的校验结果
 * @returns 统一的 ToolGuardResult 对象
 */
export function normalizeToolGuardResult(
    r: string | null | undefined | ToolGuardResult
): ToolGuardResult {
    // 1. 处理“通过”的情况：如果结果为空（null 或 undefined），视作校验无异议，允许放行
    if (r == null) {
        return { allow: true };
    }

    // 2. 处理“已结构化”的情况：如果返回的已经是一个包含 'allow' 属性的对象，直接原样返回
    // 这种情况通常来自新版的权限逻辑，已经自带了 errorCode 或 auditMeta
    if (typeof r === "object" && r !== null && "allow" in r) {
        return r;
    }

    // 3. 处理“旧版字符串”或“兜底”情况：
    // 如果返回的是字符串（即错误消息），则将其包装成失败结构
    // errorCode 默认为 "POLICY_UNKNOWN"，表示这是从未分类的旧逻辑中拦截的
    return { 
        allow: false, 
        message: String(r), 
        errorCode: "POLICY_UNKNOWN" 
    };
}
