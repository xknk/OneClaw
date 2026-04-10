/**
 * Agent 与工具类型定义
 */

import type { ToolRiskLevel } from "../tools/types";

/** 单个工具的接口 */
export interface Tool {
    name: string;
    description: string;
    /** 内置工具用于 builtinProvider；技能/MCP 工具可省略，由各自 provider 决定 */
    riskLevel?: ToolRiskLevel;
    execute(args: Record<string, unknown>): Promise<string>;
}

/** 从模型输出中解析出的一次工具调用 */
export interface ParsedToolCall {
    name: string;
    args: Record<string, unknown>;
}