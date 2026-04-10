import { describe, expect, it } from "vitest";
import {
    estimateTextTokens,
    estimateMessagesTokens,
    trimMessagesToTokenBudget,
    trimMessageContentTail,
} from "@/session/contextLimit";

describe("contextLimit", () => {
    it("estimateTextTokens: CJK vs ASCII", () => {
        expect(estimateTextTokens("你好")).toBe(2);
        expect(estimateTextTokens("abcd")).toBe(1);
    });

    it("trimMessagesToTokenBudget keeps newest first", () => {
        const msgs = [
            { role: "user" as const, content: "a".repeat(4000) },
            { role: "assistant" as const, content: "short" },
        ];
        const out = trimMessagesToTokenBudget(msgs, {
            maxTokens: 50,
            singleMessageMaxTokens: 40,
        });
        expect(out.length).toBeGreaterThan(0);
        expect(out[out.length - 1]?.content).toContain("short");
    });

    it("trimMessageContentTail preserves tail", () => {
        const s = "x".repeat(100) + "END";
        const t = trimMessageContentTail(s, 5);
        expect(t).toContain("END");
        expect(t).toContain("截断");
    });

    it("estimateMessagesTokens sums roles", () => {
        const n = estimateMessagesTokens([
            { role: "user", content: "hi" },
            { role: "assistant", content: "ok" },
        ]);
        expect(n).toBeGreaterThan(8);
    });
});
