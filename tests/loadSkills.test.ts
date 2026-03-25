import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import { loadSkillsForContext } from "@/skills/loadSkills";

/**
 * 1. 【深度 Mock】：拦截 Node.js 原生模块 'fs/promises'
 * 这样做的目的是完全切断测试与硬盘的联系。
 * 无论源码调用多少次 readdir 或 readFile，都不会真的去读磁盘。
 */
vi.mock("fs/promises", () => ({
    default: {
        readdir: vi.fn(), // 创建一个可追踪的假函数
        readFile: vi.fn(), // 同上
    },
}));

describe("loadSkillsForContext / 技能启用条件测试", () => {
    // 获取被 Mock 后的函数引用，方便后续在 beforeEach 中设置“假答案”
    const readdirMock = vi.mocked(fs.readdir);
    const readFileMock = vi.mocked(fs.readFile);

    beforeEach(() => {
        /**
         * 2. 【预设假答案】：
         * 每当源码调用 readdir，告诉它目录下有一个 "skills.json" 文件。
         */
        readdirMock.mockResolvedValue(["skills.json"] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
        /**
         * 每当源码调用 readFile，直接给它返回一个包含测试数据的 JSON 字符串。
         * 这就是为什么你之前在报错里看到的是“OneClaw”，
         * 因为之前拦截失败了，读到了真文件；而这里强制返回了 A, B, C, D。
         */
        readFileMock.mockImplementation(async () =>
            JSON.stringify({
                skills: [
                    { id: "always", systemPrompt: "A" },
                    { id: "qq-only", systemPrompt: "B", enableWhen: { channelIds: ["qq"] } },
                    { id: "agent-daily", systemPrompt: "C", enableWhen: { agentIds: ["daily_report"] } },
                    { id: "keyword", systemPrompt: "D", enableWhen: { keywordsAny: ["日报"] } },
                ],
            })
        );
    });

    afterEach(() => {
        // 每次测试完清空记录，防止上一个测试的调用次数影响下一个
        vi.clearAllMocks();
    });

    it("无 enableWhen 的技能始终加载", async () => {
        const r = await loadSkillsForContext({
            channelId: "webchat",
            sessionKey: "x",
            agentId: "main",
            userText: "hi",
        });
        // 预期：无论环境如何，A 技能对应的 Prompt 应该存在
        expect(r.systemPrompts.join("\n")).toContain("A");
    });

    it("channelIds 过滤逻辑：只在匹配的渠道加载", async () => {
        // 场景 A：网页渠道
        const r = await loadSkillsForContext({
            channelId: "webchat",
            sessionKey: "x",
            agentId: "main",
            userText: "hi",
        });
        expect(r.systemPrompts.join("\n")).not.toContain("B");

        // 场景 B：切换到 QQ 渠道
        const r2 = await loadSkillsForContext({
            channelId: "qq",
            sessionKey: "x",
            agentId: "main",
            userText: "hi",
        });
        expect(r2.systemPrompts.join("\n")).toContain("B");
    });

    it("agentIds 过滤逻辑：只对特定 Agent 加载", async () => {
        const r = await loadSkillsForContext({
            channelId: "webchat",
            sessionKey: "x",
            agentId: "main",
            userText: "hi",
        });
        expect(r.systemPrompts.join("\n")).not.toContain("C");

        const r2 = await loadSkillsForContext({
            channelId: "webchat",
            sessionKey: "x",
            agentId: "daily_report", // 匹配技能 C 的条件
            userText: "hi",
        });
        expect(r2.systemPrompts.join("\n")).toContain("C");
    });

    it("keywordsAny 过滤逻辑：根据用户输入内容触发", async () => {
        const r = await loadSkillsForContext({
            channelId: "webchat",
            sessionKey: "x",
            agentId: "main",
            userText: "请写日报", // 命中“日报”关键词
        });
        expect(r.systemPrompts.join("\n")).toContain("D");
    });
});
