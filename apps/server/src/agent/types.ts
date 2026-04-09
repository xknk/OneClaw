/**
 * Agent 与工具类型定义
 */

/** 单个工具的接口 */
export interface Tool {
    name: string;
    description: string;
    execute(args: Record<string, unknown>): Promise<string>;
}

/** 从模型输出中解析出的一次工具调用 */
export interface ParsedToolCall {
    name: string;
    args: Record<string, unknown>;
}