// src/agent/withSkills.ts - 兼容旧逻辑，调试使用，后续废弃

import { getToolSchemas } from "./tools/index";
import type { ToolSchema } from "@/llm/providers/ModelProvider";
import { loadSkillsFromWorkspace, loadSkillsForContext, type SkillRuntimeContext } from "@/skills/loadSkills";
import { getBuiltInToolAllowlistForAgent } from "@/agent/agentRegistry"
export type { SkillRuntimeContext };


/**
 * 工具过滤器：根据白名单筛选工具 Schema
 * @param schemas 待筛选的工具列表
 * @param allow 允许的工具名集合（Set）。如果为 null，则表示不限制，允许全部。
 */
function filterSchemasByAllowlist(schemas: ToolSchema[], allow: Set<string> | null): ToolSchema[] {
    if (!allow) return schemas; // 如果允许的工具名集合为 null，则表示不限制，允许全部
    return schemas.filter((t) => allow.has(t.name)); // 如果允许的工具名集合为 null，则表示不限制，允许全部
}

/**
 * 【汇总工具集】- 标注仅兼容/调试用
 * 将“系统内置工具”与“外部 Skill 扩展工具”进行合并。
 * 该函数后续可替代 runAgent 中硬编码的 getToolSchemas()，实现动态能力加载。
 */
export async function getCombinedToolSchemas(): Promise<ToolSchema[]> {
    // 1. 获取系统预设的内置工具描述
    const base = getToolSchemas();
    // 2. 从用户的 workspace/skills 目录加载自定义技能中的工具
    const { toolSchemas: skillTools } = await loadSkillsFromWorkspace();
    // 3. 使用 Map 进行去重处理（Key 为工具名称）
    const map = new Map<string, ToolSchema>();
    // 先填充内置工具
    for (const t of base) {
        map.set(t.name, t);
    }
    // 再填充 Skill 工具
    // 如果 Skill 中存在同名工具，根据 Map 的特性，它将“覆盖”掉内置的同名工具
    // 这允许用户通过配置文件自定义或修正系统默认行为
    for (const t of skillTools) {
        map.set(t.name, t);
    }
    // 4. 返回合并并去重后的工具 Schema 数组
    return [...map.values()];
}

/**
 * [智能上下文合并模式 - 推荐使用]
 * 核心逻辑：
 * 1. 只加载满足当前环境（关键词、频道等）命中的技能。
 * 2. 严格遵守当前 Agent 的工具白名单配置。
 */
export async function getCombinedToolSchemasForContext(ctx: SkillRuntimeContext): Promise<ToolSchema[]> {
    // 1. 获取当前 Agent 配置的工具允许列表（白名单）
    const allow = getBuiltInToolAllowlistForAgent(ctx.agentId);
    // 2. 获取并过滤内置工具：只有在白名单内的内置工具才会被选中
    const base = filterSchemasByAllowlist(getToolSchemas(), allow);
    // 3. 动态加载当前上下文命中的技能工具（根据关键词、AgentID 等过滤）
    const { toolSchemas: skillTools } = await loadSkillsForContext(ctx);
    // 4. 再次过滤技能工具：确保即使技能命中了，里面的工具也必须在 Agent 的白名单内
    const skillPart = filterSchemasByAllowlist(skillTools, allow);
    // 5. 合并去重
    const map = new Map<string, ToolSchema>();
    for (const t of base) {
        map.set(t.name, t);
    }
    for (const t of skillPart) {
        map.set(t.name, t);
    }
    // 返回最终要发送给大模型（LLM）的 tools 参数数组
    return [...map.values()];
}