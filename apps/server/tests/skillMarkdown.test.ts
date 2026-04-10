import { describe, it, expect } from "vitest";
import {
    skillFromMarkdown,
    splitMarkdownFrontmatter,
    extractMultiLineField,
} from "@/skills/skillMarkdown";

describe("skillFromMarkdown", () => {
    it("parses frontmatter id and uses body as systemPrompt", () => {
        const md = `---
id: demo:hello
name: Hello
---
Say hello politely.`;
        const s = skillFromMarkdown(md, "/tmp/x.md");
        expect(s.id).toBe("demo:hello");
        expect(s.name).toBe("Hello");
        expect(s.systemPrompt).toContain("Say hello politely");
    });

    it("throws clear error when id missing", () => {
        const md = `---
name: X
---
body`;
        expect(() => skillFromMarkdown(md, "/tmp/bad.md")).toThrow("/tmp/bad.md");
    });

    it("parse enableWhen JSON", () => {
        const md = `---
id: t:k
enableWhen: {"channelIds":["qq"]}
---
Hi`;
        const s = skillFromMarkdown(md, "/tmp/e.md");
        expect(s.enableWhen?.channelIds).toEqual(["qq"]);
    });
});

describe("splitMarkdownFrontmatter", () => {
    it("returns null without opening ---", () => {
        expect(splitMarkdownFrontmatter("no front")).toBeNull();
    });
});

describe("extractMultiLineField / tools", () => {
    it("parses multiline JSON array for tools", () => {
        const metaLines = [
            "id: x",
            "tools:",
            "  [",
            '    {"name": "a", "description": "d", "parameters": {"type": "object", "properties": {}}}',
            "  ]",
            "name: y",
        ];
        const raw = extractMultiLineField(metaLines, "tools");
        expect(raw).toBeTruthy();
        const arr = JSON.parse(raw!);
        expect(Array.isArray(arr)).toBe(true);
        expect(arr[0].name).toBe("a");
    });
});
