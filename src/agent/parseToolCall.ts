/**
 * 增强版工具调用解析函数
 * 优化点：支持嵌套 Markdown 代码块过滤、预处理非标准 JSON、增强容错
 */

import type { ParsedToolCall } from "./types";

// 匹配模式：支持 <tool_call> 标签，并兼容内部可能存在的 ```json 块
const ENHANCED_TOOL_REGEX = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export interface EnhancedParseResult {
    /** 过滤掉所有标签后的纯文本 */
    text: string;
    /** 解析成功的工具列表 */
    toolCalls: ParsedToolCall[];
    /** 解析失败的原始字符串（可选，用于调试或重新引导 AI） */
    invalidBlocks: string[];
}

/**
 * 通用解析工具
 */
export function parseToolCalls(modelOutput: string): EnhancedParseResult {
    const toolCalls: ParsedToolCall[] = [];
    const invalidBlocks: string[] = [];

    // 1. 提取所有匹配项
    const matches = Array.from(modelOutput.matchAll(ENHANCED_TOOL_REGEX));

    for (const match of matches) {
        let rawContent = match[1].trim();

        // 优化：去除 AI 可能错误添加的 Markdown 代码块标签 ```json ... ```
        if (rawContent.startsWith("```")) {
            rawContent = rawContent.replace(/^```[a-z]*\n?|```$/g, "").trim();
        }

        try {
            // 尝试解析
            const obj = JSON.parse(rawContent);
            
            // 结构检查与规范化
            const name = obj.name || obj.tool_name || ""; // 兼容不同模型的字段名
            const args = (obj.args && typeof obj.args === "object") ? obj.args : (obj.parameters || {});

            if (name) {
                toolCalls.push({ name: String(name), args });
            } else {
                invalidBlocks.push(rawContent);
            }
        } catch (e) {
            // 记录解析失败的块，方便后续处理
            invalidBlocks.push(rawContent);
        }
    }

    // 2. 生成纯文本：移除所有 <tool_call> 块及其前后的多余换行
    const text = modelOutput.replace(ENHANCED_TOOL_REGEX, "").replace(/\n{3,}/g, "\n\n").trim();

    return { text, toolCalls, invalidBlocks };
}
