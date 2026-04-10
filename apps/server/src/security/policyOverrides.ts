/**
 * policy-overrides.json 类型与合并逻辑（不 import policy.ts，避免循环依赖）
 */
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "@/config/evn";

export type PermissionProfileOverride = {
    allowReadWorkspace?: boolean;
    allowWriteWorkspace?: boolean;
    allowExec?: boolean;
    pathAllowlistPrefixes?: string[];
    pathDenylistPatternSources?: string[];
    execAllowlistPatternSources?: string[];
    execMaxCommandLength?: number;
    execForbiddenSubstrings?: string[];
};

export type PolicyOverridesFile = {
    profiles?: Record<string, PermissionProfileOverride>;
};

function compilePatternSources(sources: string[] | undefined, label: string): RegExp[] {
    if (!sources?.length) return [];
    const out: RegExp[] = [];
    for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        try {
            out.push(new RegExp(s));
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`policy-overrides.json ${label}[${i}] 非法正则: ${JSON.stringify(s)} — ${msg}`);
        }
    }
    return out;
}

export function readPolicyOverridesFile(): PolicyOverridesFile | null {
    const file = path.join(appConfig.dataDir, "policy-overrides.json");
    if (!fs.existsSync(file)) return null;
    let raw: string;
    try {
        raw = fs.readFileSync(file, "utf-8");
    } catch {
        return null;
    }
    try {
        return JSON.parse(raw) as PolicyOverridesFile;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${file} JSON 解析失败: ${msg}`);
    }
}

type ProfileShape = {
    allowReadWorkspace: boolean;
    allowWriteWorkspace: boolean;
    allowExec: boolean;
    execAllowlistPatterns?: RegExp[];
    pathAllowlistPrefixes?: string[];
    pathDenylistPatterns?: RegExp[];
    execMaxCommandLength?: number;
    execForbiddenSubstrings?: string[];
};

/** 合并单 profile；path/exec 的正则以「追加」方式合并进副本 */
export function mergeProfileOverride(base: ProfileShape, o: PermissionProfileOverride): ProfileShape {
    const next: ProfileShape = {
        allowReadWorkspace: o.allowReadWorkspace ?? base.allowReadWorkspace,
        allowWriteWorkspace: o.allowWriteWorkspace ?? base.allowWriteWorkspace,
        allowExec: o.allowExec ?? base.allowExec,
        execAllowlistPatterns: base.execAllowlistPatterns ? [...base.execAllowlistPatterns] : undefined,
        pathAllowlistPrefixes: base.pathAllowlistPrefixes ? [...base.pathAllowlistPrefixes] : undefined,
        pathDenylistPatterns: base.pathDenylistPatterns ? [...base.pathDenylistPatterns] : undefined,
        execMaxCommandLength: o.execMaxCommandLength ?? base.execMaxCommandLength,
        execForbiddenSubstrings: base.execForbiddenSubstrings ? [...base.execForbiddenSubstrings] : undefined,
    };
    if (o.pathAllowlistPrefixes !== undefined) {
        next.pathAllowlistPrefixes = [...o.pathAllowlistPrefixes];
    }
    if (o.execForbiddenSubstrings !== undefined) {
        next.execForbiddenSubstrings = [...o.execForbiddenSubstrings];
    }
    const extraDeny = compilePatternSources(o.pathDenylistPatternSources, "pathDenylistPatternSources");
    if (extraDeny.length) {
        next.pathDenylistPatterns = [...(next.pathDenylistPatterns ?? []), ...extraDeny];
    }
    const extraExec = compilePatternSources(o.execAllowlistPatternSources, "execAllowlistPatternSources");
    if (extraExec.length) {
        next.execAllowlistPatterns = [...(next.execAllowlistPatterns ?? []), ...extraExec];
    }
    return next;
}
