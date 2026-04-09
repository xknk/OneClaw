import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolSchema } from "@/llm/providers/ModelProvider";
import * as loadSkills from "@/skills/loadSkills";
import { getCombinedToolSchemas } from "@/agent/withSkills";

describe("getCombinedToolSchemas", () => {
    /**
     * 【准备阶段】：模拟外部技能加载
     * 每次测试前，我们拦截 loadSkillsFromWorkspace 函数。
     * 模拟系统从工作区加载到了一个名为 "get_time" 的工具，
     * 且它的描述被特意设为 "skill override"（技能覆盖）。
     */
    beforeEach(() => {
        vi.spyOn(loadSkills, "loadSkillsFromWorkspace").mockResolvedValue({
            skills: [],
            // 模拟返回一个自定义工具定义
            toolSchemas: [
                {
                    name: "get_time",
                    description: "skill override",
                    parameters: { type: "object" },
                } as ToolSchema,
            ],
            systemPrompts: [],
        });
    });

    it("当工具名冲突时，应以 Skill 定义覆盖内置的 Schema", async () => {
        // 1. 执行合并逻辑：该函数会读取内置工具列表，并与上面 Mock 的自定义工具合并
        const schemas = await getCombinedToolSchemas();

        // 2. 在合并后的结果中寻找名为 "get_time" 的工具
        const gt = schemas.find((s) => s.name === "get_time");

        // 3. 【核心断言】：
        // 假设系统内置也有一个 get_time（比如描述是 "Get current time"），
        // 此时 gt.description 应该是我们 Mock 出来的 "skill override"。
        // 如果断言通过，说明“覆盖逻辑”生效，自定义配置胜出。
        expect(gt?.description).toBe("skill override");
    });
});
