// src/skills/loadSkills.ts

import fs from "fs/promises";
import path from "path";
import { appConfig } from "@/config/evn";
import type { LoadedSkills, Skill, SkillEnableWhen } from "./types";
import type { ToolSchema } from "@/llm/providers/ModelProvider";

/** 
 * 获取技能配置存放的绝对路径 
 * 路径优先级遵循 appConfig 配置，通常在用户家目录的工作空间内
 */
function getSkillsDir(): string {
    return path.join(appConfig.skillsDir, "skills");
}

/**
 * 核心解析逻辑：将不确定的 JSON 数据转换为标准 Skill 数组
 * 兼容两种配置风格：
 * 1. 数组风: { "skills": [ {...}, {...} ] }
 * 2. 单对象风: { "id": "my-skill", ... }
 */
function parseSkillJson(json: unknown): Skill[] {
    if (!json || typeof json !== "object") return [];

    const anyJson = json as { skills?: unknown };

    // 场景 1：如果是包含 skills 数组的对象格式
    if (Array.isArray(anyJson.skills)) {
        return anyJson.skills.filter((s): s is Skill =>
            !!(s && typeof s === "object" && (s as Skill).id)
        );
    }

    // 场景 2：如果是单个 Skill 对象格式
    const maybeSkill = json as Skill;
    if (maybeSkill && typeof maybeSkill === "object" && typeof maybeSkill.id === "string") {
        return [maybeSkill];
    }

    return [];
}

/** 
 * 单次请求的运行上下文
 * 包含了判断一个 Skill 是否应该启用的所有必要参数
 */
export interface SkillRuntimeContext {
    channelId: string;  // 渠道来源 (如: qq, web)
    sessionKey: string; // 会话标识 (如: group_123, user_456)
    agentId: string;    // 当前响应的机器人 ID
    userText: string;   // 用户输入的原始文本
}

/** 
 * 核心匹配算法：判断某个技能是否满足当前上下文的启用条件 
 */
function matchEnableWhen(skill: Skill, ctx: SkillRuntimeContext): boolean {
    const rule: SkillEnableWhen | undefined = skill.enableWhen;

    // 如果没写 enableWhen 规则，默认该技能对所有场景生效
    if (!rule) return true;

    // 1. 渠道过滤 (Whitelist)
    if (rule.channelIds?.length) {
        if (!rule.channelIds.includes(ctx.channelId)) return false;
    }

    // 2. 会话前缀过滤 (常用于区分群聊与私聊)
    if (rule.sessionKeyPrefixes?.length) {
        const ok = rule.sessionKeyPrefixes.some((p) => ctx.sessionKey.startsWith(p));
        if (!ok) return false;
    }

    // 3. 关联 Agent 过滤
    if (rule.agentIds?.length) {
        if (!rule.agentIds.includes(ctx.agentId)) return false;
    }

    // 4. 关键词触发 (最灵活的逻辑)
    if (rule.keywordsAny?.length) {
        const lower = ctx.userText.toLowerCase();
        // 只要用户输入的文本中包含 keywordsAny 中的任意一个词，即命中
        const hit = rule.keywordsAny.some((k) => lower.includes(k.toLowerCase()));
        if (!hit) return false;
    }

    return true;
}

/** 
 * 将筛选出的多个 Skill 对象扁平化
 * 将 tools 提取到一起，将 systemPrompts 提取到一起
 */
function flattenSkills(skills: Skill[]): LoadedSkills {
    const toolSchemas: ToolSchema[] = []; // 收集所有工具定义
    const systemPrompts: string[] = []; // 收集所有系统提示词片段

    for (const skill of skills) {
        // 收集所有工具定义
        if (skill.tools && Array.isArray(skill.tools)) {
            for (const t of skill.tools) {
                if (t && typeof t.name === "string") {
                    toolSchemas.push(t);
                }
            }
        }
        // 收集所有系统提示词片段
        if (typeof skill.systemPrompt === "string" && skill.systemPrompt.trim() !== "") {
            systemPrompts.push(skill.systemPrompt.trim());
        }
    }

    return { skills, toolSchemas, systemPrompts };
}


//  基础方法：从硬盘读取全部 Skill 配置文件（不涉及逻辑过滤）
export async function loadRawSkillsFromDisk(): Promise<Skill[]> {
    const dir = getSkillsDir(); // 获取技能配置存放的绝对路径
    let entries: string[] = []; // 收集所有技能配置文件名
    try {
        entries = await fs.readdir(dir); // 读取技能配置目录下的所有文件名
    } catch {
        // 如果目录不存在，静默返回空数组
        return []; // 如果目录不存在，静默返回空数组
    }
    // 收集所有 Skill 对象
    const skills: Skill[] = [];

    for (const name of entries) {
        // 只处理 .json 文件
        if (!name.toLowerCase().endsWith(".json")) continue;

        const fullPath = path.join(dir, name);
        try {
            const text = await fs.readFile(fullPath, "utf-8"); // 读取技能配置文件内容
            const json = JSON.parse(text) as unknown; // 解析技能配置文件内容
            const parsed = parseSkillJson(json); // 解析技能配置文件内容
            skills.push(...parsed); // 将解析后的 Skill 对象添加到 skills 数组中
        } catch (err) {
            console.error(`[skills] 载入失败: ${fullPath}`, err); // 如果解析失败，打印错误信息
        }
    }

    return skills; // 返回收集的所有 Skill 对象
}


/**
 * 【主函数】从本地文件系统加载并汇总所有技能- 标注仅兼容/调试用
 * 返回 LoadedSkills 对象，包含展平后的工具集和提示词集
 */
export async function loadSkillsFromWorkspace(): Promise<LoadedSkills> {
    const skills = await loadRawSkillsFromDisk();
    return flattenSkills(skills);
}

/** 
 * 高级方法：基于当前上下文动态加载匹配的 Skill
 * 只有命中的技能才会被发送给 LLM，既节省 Token 又能防止技能冲突
 */
export async function loadSkillsForContext(ctx: SkillRuntimeContext): Promise<LoadedSkills> {
    const all = await loadRawSkillsFromDisk();
    // 过滤：只有 matchEnableWhen 返回 true 的技能才被留下
    const filtered = all.filter((s) => matchEnableWhen(s, ctx));
    return flattenSkills(filtered);
}