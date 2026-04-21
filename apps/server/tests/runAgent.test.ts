import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolSchema } from "@/llm/providers/ModelProvider";
import * as model from "@/llm/model";
import { runAgent, EMPTY_REPLY_FALLBACK } from "@/agent/runAgent";
import { ToolPolicyError } from "@/tasks/stepToolPolicy";

// 1. 【模拟模型层】：模拟 chatWithModelWithTools 函数，避免测试时产生真实的 API 开销
vi.mock("@/llm/model", () => ({
    chatWithModelWithTools: vi.fn(),
    resolveFallbackModelKey: vi.fn(() => null),
}));

// 2. 【模拟工具层】：扩展现有的工具库，专门为测试注入一些“特殊行为”的工具
vi.mock("@/agent/tools/index", async (importOriginal) => {
    // 获取原始模块的内容
    const mod = await importOriginal<typeof import("@/agent/tools/index")>();
    return {
        ...mod,
        // 模拟获取工具的逻辑
        getTool(name: string) {
            if (name === "throws") {
                return {
                    name: "throws",
                    description: "这是一个专门用来抛错的测试工具",
                    async execute() {
                        throw new Error("boom"); // 模拟执行期间崩溃
                    },
                };
            }
            return mod.getTool(name); // 其他工具走原逻辑
        },
        // 模拟工具定义（Schema）列表
        getToolSchemas() {
            return [
                ...mod.getToolSchemas(),
                {
                    name: "throws",
                    description: "throws on execute",
                    parameters: { type: "object" },
                },
            ];
        },
    };
});

const toolSchemas = [] as ToolSchema[];

describe("runAgent", () => {
    // 每次测试前重置 Mock 状态，确保测试用例之间互不干扰（计数清零、配置清空）
    beforeEach(() => {
        vi.mocked(model.chatWithModelWithTools).mockReset();
    });

    it("无 toolCalls 且正文为空时返回兜底文案（不再给上游空字符串）", async () => {
        vi.mocked(model.chatWithModelWithTools).mockResolvedValueOnce({
            content: "",
            toolCalls: [],
        });

        const out = await runAgent([{ role: "user", content: "hi" }], { toolSchemas });

        expect(out).toBe(EMPTY_REPLY_FALLBACK);
        expect(model.chatWithModelWithTools).toHaveBeenCalledTimes(1);
    });

    it("无 toolCalls 时直接返回模型文本", async () => {
        // 模拟模型返回：没有工具调用请求，只有一段普通文本
        vi.mocked(model.chatWithModelWithTools).mockResolvedValueOnce({
            content: "最终回答",
            toolCalls: [],
        });

        const out = await runAgent([{ role: "user", content: "hi" }], { toolSchemas });

        expect(out).toBe("最终回答");
        // 验证模型只被调用了 1 次（没有开启第二轮对话）
        expect(model.chatWithModelWithTools).toHaveBeenCalledTimes(1);
    });

    it("未知工具名将错误写进 tool 结果，模型可继续推理", async () => {
        // 模拟两轮对话：
        // 第一轮：模型想调用一个不存在的工具 "no_such_tool_xyz"
        // 第二轮：Agent 告知错误后，模型给出最终解释
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "no_such_tool_xyz", args: {} }],
            })
            .mockResolvedValueOnce({
                content: "已看到错误，改用文字说明。",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], { toolSchemas });

        expect(out).toBe("已看到错误，改用文字说明。");
        // 核心检查：Agent 是否把“未知工具”的错误信息塞进了发给模型的第二轮上下文中
        const secondMessages = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        const asText = JSON.stringify(secondMessages);
        expect(asText).toContain("错误：未知工具");
    });

    it("工具 execute 抛错时错误信息进入上下文", async () => {
        // 模拟第一轮调用那个会抛出 "boom" 错误的 "throws" 工具
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "throws", args: {} }],
            })
            .mockResolvedValueOnce({
                content: "收到异常，结束。",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], { toolSchemas });

        expect(out).toBe("收到异常，结束。");
        // 核心检查：工具执行时的 Error 对象是否被 catch 并在下一轮告知了模型
        const secondMessages = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        expect(JSON.stringify(secondMessages)).toContain("工具执行失败");
    });

    it("达到 maxToolRounds 时退出并返回最后一轮 assistant 文本", async () => {
        // 模拟模型一直想调用工具（死循环场景）
        vi.mocked(model.chatWithModelWithTools).mockResolvedValue({
            content: "仍想继续调工具",
            toolCalls: [{ name: "echo", args: { text: "x" } }],
        });

        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            maxToolRounds: 2, // 限制最多只跑 2 轮
        });

        // 验证调用次数被截断在了 2 次，没有无限循环
        expect(model.chatWithModelWithTools).toHaveBeenCalledTimes(2);
        expect(out).toBe("仍想继续调工具");
    });

    it("达到 maxToolRounds 且最后一轮正文为空时追加无工具合成轮", async () => {
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "echo", args: { text: "x" } }],
            })
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "echo", args: { text: "y" } }],
            })
            .mockResolvedValueOnce({
                content: "合成后的目录列表说明",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "列目录" }], {
            toolSchemas,
            maxToolRounds: 2,
        });

        expect(out).toBe("合成后的目录列表说明");
        expect(model.chatWithModelWithTools).toHaveBeenCalledTimes(3);
        const synthCall = vi.mocked(model.chatWithModelWithTools).mock.calls[2]![0];
        expect(JSON.stringify(synthCall)).toContain("请根据上述工具执行结果");
    });

    it("toolGuard 拒绝时拒绝原因进入 tool 结果", async () => {
        // 模拟模型想调 echo 工具
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "echo", args: { text: "a" } }],
            })
            .mockResolvedValueOnce({
                content: "知道了",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            // 模拟权限守卫：直接返回拒绝理由
            toolGuard: () => "无权限：测试拒绝",
        });

        expect(out).toBe("知道了");
        // 核心检查：拒绝理由是否作为工具的输出结果传回给了模型
        const second = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        expect(JSON.stringify(second)).toContain("无权限：测试拒绝");
    });
    /**
     * 测试 toolGuard 返回结构化拒绝时同样把 message 写入 tool 结果
     */
    it("toolGuard 返回结构化拒绝时同样把 message 写入 tool 结果", async () => {
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "echo", args: { text: "a" } }],
            })
            .mockResolvedValueOnce({
                content: "收到了",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            toolGuard: () => ({
                allow: false as const,
                message: "无权限：结构化拒绝",
                errorCode: "POLICY_RUN_AGENT_TEST",
            }),
        });

        expect(out).toBe("收到了");
        const second = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        expect(JSON.stringify(second)).toContain("无权限：结构化拒绝");
    });

    it("自定义 executeTool 抛错时转为工具结果字符串，不中断对话", async () => {
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "any", args: {} }],
            })
            .mockResolvedValueOnce({
                content: "已处理异常说明",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            executeTool: async () => {
                throw new Error("provider boom");
            },
        });

        expect(out).toBe("已处理异常说明");
        const second = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        expect(JSON.stringify(second)).toContain("工具执行异常:");
    });

    it("自定义 executeTool 抛出 ToolPolicyError 时转为策略拒绝文案", async () => {
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "any", args: {} }],
            })
            .mockResolvedValueOnce({
                content: "知道了",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            executeTool: async () => {
                throw new ToolPolicyError("NOT_IN_ALLOWLIST", "不在白名单", { toolName: "x" });
            },
        });

        expect(out).toBe("知道了");
        const second = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        expect(JSON.stringify(second)).toContain("策略拒绝：");
    });

    it("模型层抛错时返回可读文案并触发 llm.error 事件", async () => {
        vi.mocked(model.chatWithModelWithTools).mockRejectedValueOnce(new Error("ollama offline"));

        const events: { type: string; error?: string }[] = [];
        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            onModelEvent: (e) => {
                if (e.type === "llm.error") events.push({ type: e.type, error: e.error });
            },
        });

        expect(out).toBe("模型请求失败：ollama offline");
        expect(events).toEqual([{ type: "llm.error", error: "ollama offline" }]);
        expect(model.chatWithModelWithTools).toHaveBeenCalledTimes(1);
    });

    it("默认 toolGuard 抛错时转为工具结果字符串", async () => {
        vi.mocked(model.chatWithModelWithTools)
            .mockResolvedValueOnce({
                content: "",
                toolCalls: [{ name: "echo", args: { text: "a" } }],
            })
            .mockResolvedValueOnce({
                content: "收到",
                toolCalls: [],
            });

        const out = await runAgent([{ role: "user", content: "hi" }], {
            toolSchemas,
            toolGuard: () => {
                throw new Error("policy bug");
            },
        });

        expect(out).toBe("收到");
        const second = vi.mocked(model.chatWithModelWithTools).mock.calls[1][0];
        expect(JSON.stringify(second)).toContain("工具执行异常:");
    });
});
