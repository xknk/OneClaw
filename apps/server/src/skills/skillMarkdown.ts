/**
 * 解析 skills 目录下的 .md 技能：YAML 风格 frontmatter + 正文作为 systemPrompt
 */

import type { Skill, SkillEnableWhen } from "./types";
import type { ToolSchema } from "@/llm/providers/ModelProvider";

/** 解析 `---` ... `---` 块；失败返回 null */
export function splitMarkdownFrontmatter(raw: string): { metaLines: string[]; body: string } | null {
    const text = raw.replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/);
    if (!lines[0]?.trim().startsWith("---")) return null;
    const metaLines: string[] = [];
    let i = 1;
    for (; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.trim() === "---") {
            i++;
            break;
        }
        metaLines.push(line);
    }
    if (i > lines.length) return null;
    const body = lines.slice(i).join("\n").trimEnd();
    return { metaLines, body };
}

/** 极简 key: value 解析（每行一个键；值可含空格） */
function parseMetaLines(metaLines: string[]): Record<string, string> {
    const meta: Record<string, string> = {};
    for (const line of metaLines) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const m = t.match(/^([\w-]+):\s*(.*)$/);
        if (m) meta[m[1]] = m[2].trim();
    }
    return meta;
}

/**
 * 支持多行 JSON：`tools:` 后可为空，正文从下一行起直到下一个顶格 `key:`。
 * 单行合法 JSON 则直接返回。
 */
export function extractMultiLineField(metaLines: string[], key: string): string | undefined {
    const re = new RegExp(`^${key}:\\s*(.*)$`, "i");
    const startIdx = metaLines.findIndex((l) => re.test(l.trim()));
    if (startIdx < 0) return undefined;
    const m = metaLines[startIdx].trim().match(re);
    let buf = (m?.[1] ?? "").trim();
    if (buf.length > 0) {
        try {
            JSON.parse(buf);
            return buf;
        } catch {
            if (!buf.startsWith("[") && !buf.startsWith("{")) {
                return buf;
            }
        }
    }
    const lines: string[] = buf ? [buf] : [];
    for (let i = startIdx + 1; i < metaLines.length; i++) {
        const line = metaLines[i];
        if (/^[\w-]+:\s/.test(line) && !/^\s/.test(line)) break;
        lines.push(line);
    }
    const joined = lines.join("\n").trim();
    return joined || undefined;
}

function parseJsonField<T>(label: string, raw: string | undefined, filePath: string): T | undefined {
    if (raw === undefined || raw === "") return undefined;
    try {
        return JSON.parse(raw) as T;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${filePath}: 字段 ${label} 不是合法 JSON: ${msg}`);
    }
}

/**
 * 将单个 .md 转为 Skill（或抛出带路径的 Error）
 */
export function skillFromMarkdown(text: string, filePath: string): Skill {
    const split = splitMarkdownFrontmatter(text);
    if (!split) {
        throw new Error(`${filePath}: Markdown 技能需以 --- 开头，并用单独一行的 --- 结束 frontmatter`);
    }
    const meta = parseMetaLines(split.metaLines);
    const id = meta.id?.trim();
    if (!id) {
        throw new Error(`${filePath}: frontmatter 缺少必填字段 id`);
    }

    let enableWhen: SkillEnableWhen | undefined;
    if (meta.enableWhen !== undefined && meta.enableWhen !== "") {
        enableWhen = parseJsonField<SkillEnableWhen>("enableWhen", meta.enableWhen, filePath);
    }

    const toolsJson = extractMultiLineField(split.metaLines, "tools") ?? meta.tools;
    let tools: ToolSchema[] | undefined;
    if (toolsJson !== undefined && toolsJson !== "") {
        const arr = parseJsonField<unknown>("tools", toolsJson, filePath);
        if (!Array.isArray(arr)) {
            throw new Error(`${filePath}: tools 必须是 JSON 数组`);
        }
        tools = arr as ToolSchema[];
    }

    const systemPromptFromMeta = meta.systemPrompt?.trim();
    const body = split.body.trim();
    const systemPrompt = systemPromptFromMeta && systemPromptFromMeta.length > 0 ? systemPromptFromMeta : body;

    const skill: Skill = {
        id,
        name: meta.name,
        description: meta.description,
        systemPrompt: systemPrompt || undefined,
        tools,
        enableWhen,
    };

    return skill;
}
