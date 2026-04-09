/**
 * 自定义 HTTP 错误类，用于统一处理网络请求异常
 * 直接继承内置的 Error 对象，使其具备堆栈追踪（Stack Trace）功能
 */
export class HttpError extends Error {
    /**
     * @param message 错误描述信息（传给父类 Error）
     * @param status  HTTP 状态码（如 404, 500）
     * @param url     发生错误的请求地址
     * @param bodySnippet 可选：返回体内容的片段，方便调试
     */
    constructor(
        message: string,
        // TypeScript 特性：在构造函数参数前加访问修饰符（public/readonly），
        // 会自动声明同名成员变量并完成赋值（this.status = status）
        public readonly status: number,
        public readonly url: string,
        public readonly bodySnippet?: string
    ) {
        // 调用父类构造函数，初始化 Error 实例
        super(message);

        // 手动设置错误名称，确保在控制台打印或日志记录时显示为 "HttpError"
        // 默认情况下，继承 Error 的子类实例 name 属性仍为 "Error"
        this.name = "HttpError";
    }
}
