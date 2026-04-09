import { describe, it, expect } from "vitest";
import { resolveAgentId } from "@/agent/agentRegistry";
import type { UnifiedInboundMessage } from "@/channels/unifiedMessage";

/**
 * 【测试工厂函数】：inbound
 * 作用：构造一个“统一输入消息”对象。
 * 理由：UnifiedInboundMessage 包含很多必填字段。通过此函数，测试用例只需关心
 * 与路由逻辑相关的字段（如 text 或 agentId），其余字段（如 channelId）使用默认值，
 * 使测试代码更清爽、更聚焦。
 */
function inbound(p: Partial<UnifiedInboundMessage>): UnifiedInboundMessage {
    return {
        channelId: "webchat",
        sessionKey: "main",
        text: "hello",
        ...p, // 将测试用例传入的特定属性覆盖进去
    } as UnifiedInboundMessage;
}

describe("resolveAgentId", () => {

    it("显式 agentId 优先", () => {
        // 验证：如果消息中已经明确指定了要找哪个 Agent（比如前端传参），则直接使用它。
        // 这通常拥有最高优先级。
        expect(resolveAgentId(inbound({ agentId: "daily_report" }))).toBe("daily_report");
    });

    it("通过斜杠命令（如 /report）绑定到对应的 Agent", () => {
        // 验证：系统能识别文本开头的特殊指令。
        // 用户输入 "/report 今日总结" 时，应该被自动分发给 daily_report。
        expect(resolveAgentId(inbound({ text: "/report 今日总结" }))).toBe("daily_report");
    });

    it("当识别出特定意图（intent）为 code_review 时进行路由", () => {
        // 验证：如果上层自然语言处理（NLP）已经预先分析出用户的意图是“代码审查”，
        // 则系统应将其指派给专门的 code_review Agent。
        expect(resolveAgentId(inbound({ intent: "code_review" }))).toBe("code_review");
    });

    it("在没有任何匹配规则时，默认降级为 main (通用 Agent)", () => {
        // 验证：系统的容错与兜底能力。
        // 既没有指令，也没有特殊意图，就走最基础的聊天逻辑。
        expect(resolveAgentId(inbound({ text: "普通聊天" }))).toBe("main");
    });
});
