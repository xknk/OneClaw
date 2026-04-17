// src/skills/types.ts

import type { ToolSchema } from "@/llm/providers/ModelProvider";

/**
 * Skill 条件启用配置：决定了该技能在什么场景下被“激活”并注入给 AI。
 * 
 * 规则：
 * 1. 如果未配置 enableWhen，则该技能视为“全局通用”，始终启用。
 * 2. 如果配置了多个字段（如同时配了 channelIds 和 agentIds），它们之间是 **AND (与)** 关系，需全部满足。
 * 3. 数组内部的多个值（如 channelIds 里的多个 ID）通常是 **OR (或)** 关系，满足其一即可。
 */
export interface SkillEnableWhen {
    /** 允许使用的渠道 ID 列表（例如：["qq", "webchat"]） */
    channelIds?: string[];
    /** 
     * 会话 Key 的前缀匹配。
     * 例如：配置 ["group_"]，则所有群聊会话均可触发此技能；配置 ["user_123"] 则仅针对特定用户。
     */
    sessionKeyPrefixes?: string[];
    /** 关联的智能体 ID 列表。只有指定的 Agent 才能调用此技能 */
    agentIds?: string[];
    /** 
     * 关键词触发：如果用户的当前输入文本中包含列表中的任意一个子串，则命中。
     * 系统在匹配时通常会进行 .toLowerCase() 处理以忽略大小写。
     */
    keywordsAny?: string[];
}

/** local 工具实现描述（Batch 6.2 先支持 local） */
export interface SkillLocalToolImpl {
    type: "local";
    /** 内置 local handler id，例如 "daily_report.generate" */
    localHandler: string;
}

/** 预留：后续 6.3 扩展 http/subagent */
export interface SkillHttpToolImpl {
    type: "http";
    url: string;
    method?: "GET" | "POST";
}

// 子Agent工具实现描述
export interface SkillSubagentToolImpl {
    type: "subagent";
    agentId: string;
}

// 工具实现描述
export type SkillToolImpl =
    | SkillLocalToolImpl
    | SkillHttpToolImpl
    | SkillSubagentToolImpl;
/**
 * 单个 Skill 的定义：
 * 采用“指令(Prompt) + 工具(Tools)”组合模式，实现原子化的 Agent 能力增强。
 */
export interface Skill {
    /** 
     * 唯一 ID，用于内部寻址和日志记录
     * 建议格式：`namespace:skill-name`（如 "github:repo-search"）
     */
    id: string;
    /** 可读名称，用于管理后台展示 */
    name?: string;
    /** 
     * 文本描述：除了给人看，有时也会传给 LLM 
     * 告知 LLM 什么时候应该“激活”或“关注”这个技能。
     */
    description?: string;
    /** 
     * 此 Skill 暴露的一组工具描述。
     * Agent 会根据这些 Schema 生成 Function Calling 的定义。
     */
    tools?: ToolSchema[];
    /** 
     * 附加的 System Prompt 片段。
     * 注入到全局 System Message 中，赋予 Agent 专业的领域知识或操作规范。
     */
    systemPrompt?: string;
    /** 
     * [扩展建议]：配置项
     * 允许在加载 Skill 时传入 API Key、BaseUrl 等动态参数
     */
    config?: Record<string, any>;
    /** 触发/启用该技能的具体条件 */
    enableWhen?: SkillEnableWhen;
    /**
    * key = tool name
    * value = 该工具的执行实现
    */
    toolImpls?: Record<string, SkillToolImpl>;
    readonly?: boolean; // 标记是否为只读/无副作用-为true时可并行执行工具
}

/**
 * 汇总结果：通常由 SkillManager 解析所有 Skill 文件后生成。
 */
export interface LoadedSkills {
    /** 原始 Skill 对象列表，方便溯源 */
    skills: Skill[];
    /** 展平后的工具列表，直接喂给 ModelProvider */
    toolSchemas: ToolSchema[];
    /** 汇总后的 Prompt 片段，通常会用 \n 连接后放入 System Message */
    systemPrompts: string[];
}
