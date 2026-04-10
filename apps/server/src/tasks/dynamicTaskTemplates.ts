import fs from "node:fs";
import type { PlanStep } from "./collaborationTypes";
import type { TaskTemplateDefinition } from "./templates";
import { getTaskTemplatesFilePath } from "@/config/runtimePaths";

function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parsePlanSkeleton(raw: unknown): Omit<PlanStep, "status">[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const steps: Omit<PlanStep, "status">[] = [];
    for (const item of raw) {
        if (!isRecord(item)) continue;
        const index = Number(item.index);
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const intent = typeof item.intent === "string" ? item.intent.trim() : "";
        if (!Number.isFinite(index) || !title || !intent) continue;
        const risk =
            item.risk === "low" || item.risk === "medium" || item.risk === "high"
                ? item.risk
                : undefined;
        let allowedTools: string[] | undefined;
        if (Array.isArray(item.allowedTools)) {
            allowedTools = item.allowedTools.filter((t): t is string => typeof t === "string");
            if (allowedTools.length === 0) allowedTools = undefined;
        }
        steps.push({
            index,
            title,
            intent,
            risk,
            allowedTools,
        });
    }
    return steps.length > 0 ? steps : undefined;
}

function parseOneTemplate(raw: unknown): TaskTemplateDefinition | null {
    if (!isRecord(raw)) return null;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const defaultTitle = typeof raw.defaultTitle === "string" ? raw.defaultTitle.trim() : "";
    if (!id || !defaultTitle) return null;

    let defaultParams: Record<string, unknown> = {};
    if (isRecord(raw.defaultParams)) {
        defaultParams = { ...raw.defaultParams };
    }

    const plannerNote =
        typeof raw.plannerNote === "string" && raw.plannerNote.trim() !== ""
            ? raw.plannerNote.trim()
            : undefined;

    const planSkeleton = parsePlanSkeleton(raw.planSkeleton);

    return {
        id,
        defaultTitle,
        defaultParams,
        planSkeleton,
        plannerNote,
    };
}

/**
 * 从磁盘读取用户定义的任务模板（失败或文件不存在时返回空对象）。
 */
export function loadDynamicTaskTemplates(): Record<string, TaskTemplateDefinition> {
    const p = getTaskTemplatesFilePath();
    try {
        if (!fs.existsSync(p)) return {};
        const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
        const list: unknown =
            isRecord(parsed) && Array.isArray(parsed.templates)
                ? parsed.templates
                : Array.isArray(parsed)
                  ? parsed
                  : [];

        const out: Record<string, TaskTemplateDefinition> = {};
        for (const item of list) {
            const t = parseOneTemplate(item);
            if (t) out[t.id] = t;
        }
        return out;
    } catch {
        return {};
    }
}

export function taskTemplatesFileExists(): boolean {
    return fs.existsSync(getTaskTemplatesFilePath());
}
