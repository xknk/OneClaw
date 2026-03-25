/**
 * 日志脱敏工具：自动识别并遮掩敏感词（如密钥、密码）
 */

// 定义敏感词黑名单，只要 Key 包含这些字符串（不区分大小写），其 Value 就会被脱敏
const SENSITIVE_KEYS = [
    "password", "token", "api_key", "apikey", "apiKey", "secret", "authorization",
    "cookie", "session", "webchat_token", "WEBCHAT_TOKEN",
];

/**
 * 核心脱敏操作：将敏感字符串处理为 "前两位 + ***"
 * 例如: "mysecret123" -> "my***"
 */
function redactValue(val: unknown): unknown {
    if (val == null) return val;
    // 仅对长度大于4的字符串脱敏，保留前2位，后面用 *** 代替
    if (typeof val === "string" && val.length > 4) return val.slice(0, 2) + "***";
    // 如果值是嵌套对象，则递归处理
    if (typeof val === "object") return redactObject(val as Record<string, unknown>);
    return val;
}

/**
 * 遍历对象属性，识别敏感 Key
 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        const lower = k.toLowerCase();
        // 检查当前的键名 (k) 是否包含黑名单中的任意一个词
        const sensitive = SENSITIVE_KEYS.some((s) => lower.includes(s.toLowerCase()));
        
        // 如果是敏感键，调用 redactValue 脱敏；否则继续深层递归检查
        out[k] = sensitive ? redactValue(v) : redactObjectDeep(v);
    }
    return out;
}

/**
 * 深度递归辅助函数：处理数组或非敏感路径上的嵌套对象
 */
function redactObjectDeep(val: unknown): unknown {
    if (val == null || typeof val !== "object") return val;
    if (Array.isArray(val)) return val.map(redactObjectDeep); // 数组则对每个成员进行检查
    return redactObject(val as Record<string, unknown>);
}

/** 
 * 对外暴露的主函数：将对象或错误转换为脱敏后的字符串
 * 用于日志输出：console.log(redactForLog(userInput))
 */
export function redactForLog(obj: unknown): string {
    // 1. 处理 Error 对象：只打印错误名和消息，不打印堆栈或可能包含敏感信息的 detail
    if (obj instanceof Error) {
        return `${obj.name}: ${obj.message}`;
    }
    // 2. 处理普通对象：脱敏后转为 JSON 字符串
    if (typeof obj === "object" && obj !== null) {
        try {
            return JSON.stringify(redactObject(obj as Record<string, unknown>));
        } catch (e) {
            return "[Log Redaction Error]"; // 防止循环引用导致 JSON 序列化失败
        }
    }
    // 3. 处理基本类型（string, number 等）
    return String(obj);
}
