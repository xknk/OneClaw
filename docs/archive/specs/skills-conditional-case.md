# OneClaw 条件启用 Skills 案例

本文是一个可直接复用的案例：实现「仅在满足条件时注入并使用 Skills」。

适用场景：
- 只有在某些关键词出现时才启用某个 Skill（例如日报）
- 只有特定渠道（`webchat` / `qq`）才启用某些 Skill
- 只有特定会话（`sessionKey` 前缀）才启用某些 Skill

---

## 1. 目标

把当前“全量注入所有 skills”的逻辑改成“按请求上下文过滤后再注入”，实现硬约束。

当前流程（已实现）：
- `loadSkillsFromWorkspace()`：加载全部 skills
- `getCombinedToolSchemas()`：合并全部内置/skills tools
- `handleUnifiedChat()`：注入全部 `systemPrompts`

目标流程：
- `loadSkillsForContext(ctx)`：加载并过滤 skills
- `getCombinedToolSchemasForContext(ctx)`：只合并命中的 skills tools
- `handleUnifiedChat()`：只注入命中的 `systemPrompts`

---

## 2. 需要改的文件

- `src/skills/types.ts`
- `src/skills/loadSkills.ts`
- `src/agent/withSkills.ts`
- `src/server/chatProcessing.ts`
- （可选）`workspace/skills/*.json`：增加 `enableWhen`

---

## 3. 代码修改示例

## 3.1 `src/skills/types.ts`

在 `Skill` 中加入条件字段：

```ts
import type { ToolSchema } from "@/llm/providers/ModelProvider";

export interface SkillEnableWhen {
    channelIds?: string[];
    sessionKeyPrefixes?: string[];
    keywordsAny?: string[];
}

export interface Skill {
    id: string;
    name?: string;
    description?: string;
    tools?: ToolSchema[];
    systemPrompt?: string;
    config?: Record<string, any>;

    // 新增：条件启用规则（全部可选）
    enableWhen?: SkillEnableWhen;
}

export interface LoadedSkills {
    skills: Skill[];
    toolSchemas: ToolSchema[];
    systemPrompts: string[];
}
```

---

## 3.2 `src/skills/loadSkills.ts`

新增“按上下文加载”的能力（保留 `loadSkillsFromWorkspace`，避免破坏现有调用）。

```ts
import type { LoadedSkills, Skill } from "./types";
import type { ToolSchema } from "@/llm/providers/ModelProvider";

export interface SkillRuntimeContext {
    channelId: string;
    sessionKey: string;
    userText: string;
}

function matchEnableWhen(skill: Skill, ctx: SkillRuntimeContext): boolean {
    const rule = skill.enableWhen;
    if (!rule) return true; // 未配置规则则默认启用

    if (rule.channelIds?.length) {
        if (!rule.channelIds.includes(ctx.channelId)) return false;
    }

    if (rule.sessionKeyPrefixes?.length) {
        const ok = rule.sessionKeyPrefixes.some((p) => ctx.sessionKey.startsWith(p));
        if (!ok) return false;
    }

    if (rule.keywordsAny?.length) {
        const text = ctx.userText.toLowerCase();
        const ok = rule.keywordsAny.some((k) => text.includes(k.toLowerCase()));
        if (!ok) return false;
    }

    return true;
}

export async function loadSkillsForContext(ctx: SkillRuntimeContext): Promise<LoadedSkills> {
    const all = await loadSkillsFromWorkspace();
    const matchedSkills = all.skills.filter((s) => matchEnableWhen(s, ctx));

    const toolSchemas: ToolSchema[] = [];
    const systemPrompts: string[] = [];
    for (const skill of matchedSkills) {
        if (skill.tools?.length) {
            for (const t of skill.tools) {
                if (t?.name) toolSchemas.push(t);
            }
        }
        if (skill.systemPrompt?.trim()) {
            systemPrompts.push(skill.systemPrompt.trim());
        }
    }

    return { skills: matchedSkills, toolSchemas, systemPrompts };
}
```

---

## 3.3 `src/agent/withSkills.ts`

新增按上下文合并工具 schemas 的函数：

```ts
import { getToolSchemas } from "./tools/index";
import type { ToolSchema } from "@/llm/providers/ModelProvider";
import {
    loadSkillsForContext,
    type SkillRuntimeContext,
} from "@/skills/loadSkills";

export async function getCombinedToolSchemasForContext(
    ctx: SkillRuntimeContext
): Promise<ToolSchema[]> {
    const base = getToolSchemas();
    const { toolSchemas: skillTools } = await loadSkillsForContext(ctx);

    const map = new Map<string, ToolSchema>();
    for (const t of base) map.set(t.name, t);
    for (const t of skillTools) map.set(t.name, t);
    return [...map.values()];
}
```

---

## 3.4 `src/server/chatProcessing.ts`

把“全量加载”改成“按上下文加载”：

```ts
import {
    loadSkillsForContext,
    type SkillRuntimeContext,
} from "@/skills/loadSkills";
import { getCombinedToolSchemasForContext } from "@/agent/withSkills";

// ... inside handleUnifiedChat
const runtimeCtx: SkillRuntimeContext = {
    channelId: inbound.channelId,
    sessionKey,
    userText,
};

const { systemPrompts } = await loadSkillsForContext(runtimeCtx);
if (systemPrompts.length > 0) {
    messages = [{ role: "system", content: systemPrompts.join("\n\n") }, ...messages];
}

const toolSchemas = await getCombinedToolSchemasForContext(runtimeCtx);
const replyText = await runAgent(messages, getAllTools(), { toolSchemas });
```

---

## 4. Skill JSON 示例

文件：`workspace/skills/report-only.json`

```json
{
  "id": "report:daily-only",
  "name": "日报技能（条件启用）",
  "enableWhen": {
    "channelIds": ["webchat"],
    "sessionKeyPrefixes": ["main", "work:"],
    "keywordsAny": ["日报", "总结", "daily report"]
  },
  "systemPrompt": "仅在用户明确要求日报/总结时生效。输出结构：今日完成、问题、明日计划。"
}
```

文件：`workspace/skills/exec-guard.json`

```json
{
  "id": "exec:guard",
  "name": "命令执行守卫",
  "enableWhen": {
    "channelIds": ["webchat", "qq"]
  },
  "systemPrompt": "当前为 Windows 环境。仅当用户明确要求执行命令时才调用 exec；优先使用 dir/type 等 Windows 命令。"
}
```

---

## 5. 验证步骤

1. 重启服务。
2. 输入：`帮我生成今日日报`  
   - 预期：命中 `report-only.json`，回复结构为日报模板。
3. 输入：`你好`  
   - 预期：不命中日报关键词，不启用日报 skill。
4. 若要观察调试信息，可在 `loadSkillsForContext` 里临时输出 `matchedSkills.map(s => s.id)`。

---

## 6. 注意事项

- 仅改 `systemPrompt` 属于软约束，模型可能偶发偏离。
- 本案例核心价值在于“注入前过滤”，属于硬约束。
- 若你后续要做企业级权限控制，建议再加执行层 PolicyChecker（工具执行前二次校验）。

---

## 7. 回滚方案

若要快速回退到旧逻辑：
- `chatProcessing.ts` 恢复调用 `loadSkillsFromWorkspace()` 与 `getCombinedToolSchemas()`
- 保留新字段 `enableWhen` 不会影响旧逻辑（旧逻辑会忽略它）

