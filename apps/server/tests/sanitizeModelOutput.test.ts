import { describe, expect, it } from "vitest";
import { stripModelThinkingMarkup } from "@/llm/sanitizeModelOutput";

describe("stripModelThinkingMarkup", () => {
    it("removes think blocks and repeated closers", () => {
        const open = "\u003cthink\u003e";
        const close = "\u003c/think\u003e";
        expect(stripModelThinkingMarkup(`${open}内${close}可见`)).toBe("可见");

        const withSlash = "A" + "<\\think>内</\\think>B";
        expect(stripModelThinkingMarkup(withSlash)).toBe("AB");

        expect(stripModelThinkingMarkup(`${close}${close}`.repeat(10)).trim()).toBe("");
    });
});
