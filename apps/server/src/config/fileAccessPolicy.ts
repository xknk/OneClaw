/**
 * 文件工具（read/search/apply_patch/delete）的允许根、拒绝前缀与路径级权限。
 * 合并 .env、file-access.json；监听 JSON 热重载。
 */

import fs from "fs";
import path from "path";
import { appConfig } from "./evn";

/** read=仅读；write=读+写（含新建/追加）；full=读+写+删 */
export type PathAccessLevel = "read" | "write" | "full";

let roots: string[] = [];
let denied: string[] = [];
let pathRules: { path: string; access: PathAccessLevel }[] = [];
let defaultAccessLevel: PathAccessLevel = "full";
let watchHandle: fs.FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let ready = false;

function pathListFromEnv(key: string): string[] {
    const v = process.env[key];
    if (v === undefined || v === "") return [];
    return v
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => path.resolve(p));
}

function normalizeAccess(s: unknown): PathAccessLevel | null {
    if (s === "read" || s === "write" || s === "full") return s;
    return null;
}

function defaultAccessFromEnv(): PathAccessLevel {
    const v = process.env.ONECLAW_FILE_ACCESS_DEFAULT;
    if (v === "read" || v === "write" || v === "full") return v;
    return "full";
}

/** 当前 file-access.json 的绝对路径（受 ONECLAW_FILE_ACCESS_CONFIG 影响） */
export function resolveFileAccessJsonPath(): string {
    const explicit = process.env.ONECLAW_FILE_ACCESS_CONFIG;
    const defaultPath = path.join(appConfig.dataDir, "config", "file-access.json");
    if (explicit !== undefined && explicit.trim() !== "") {
        return path.resolve(explicit.trim());
    }
    return defaultPath;
}

function isPathInsideRoot(rootResolved: string, candidateResolved: string): boolean {
    const root = path.resolve(rootResolved);
    const cand = path.resolve(candidateResolved);
    if (cand === root) return true;
    const rel = path.relative(root, cand);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function loadJsonOverlayFromDisk(): {
    extraRoots: string[];
    deniedPrefixes: string[];
    pathRules: { path: string; access: PathAccessLevel }[];
    defaultAccess: PathAccessLevel;
} {
    const filePath = resolveFileAccessJsonPath();
    if (!fs.existsSync(filePath)) {
        return {
            extraRoots: [],
            deniedPrefixes: [],
            pathRules: [],
            defaultAccess: defaultAccessFromEnv(),
        };
    }
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const j = JSON.parse(raw) as {
            extraRoots?: unknown;
            deniedPrefixes?: unknown;
            pathRules?: unknown;
            defaultAccess?: unknown;
        };
        const extraRoots = Array.isArray(j.extraRoots)
            ? j.extraRoots.map((x) => path.resolve(String(x)))
            : [];
        const deniedPrefixes = Array.isArray(j.deniedPrefixes)
            ? j.deniedPrefixes.map((x) => path.resolve(String(x)))
            : [];
        let pathRulesParsed: { path: string; access: PathAccessLevel }[] = [];
        if (Array.isArray(j.pathRules)) {
            for (const item of j.pathRules) {
                if (!item || typeof item !== "object") continue;
                const p = (item as { path?: unknown; access?: unknown }).path;
                const a = (item as { access?: unknown }).access;
                if (typeof p !== "string") continue;
                const acc = normalizeAccess(a);
                if (!acc) continue;
                pathRulesParsed.push({ path: path.resolve(p), access: acc });
            }
        }
        let def = defaultAccessFromEnv();
        const da = normalizeAccess(j.defaultAccess);
        if (da !== null) def = da;
        return { extraRoots, deniedPrefixes, pathRules: pathRulesParsed, defaultAccess: def };
    } catch {
        return {
            extraRoots: [],
            deniedPrefixes: [],
            pathRules: [],
            defaultAccess: defaultAccessFromEnv(),
        };
    }
}

function recompute(): void {
    const envExtra = pathListFromEnv("ONECLAW_FILE_ACCESS_EXTRA_ROOTS");
    const envDenied = pathListFromEnv("ONECLAW_FILE_ACCESS_DENIED_PREFIXES");
    const json = loadJsonOverlayFromDisk();
    const extraMerged = [...new Set([...envExtra, ...json.extraRoots])];
    const deniedMerged = [...new Set([...envDenied, ...json.deniedPrefixes])];
    const userWs = path.resolve(appConfig.userWorkspaceDir);
    roots = [...new Set([userWs, ...extraMerged])];
    denied = deniedMerged;
    pathRules = json.pathRules;
    defaultAccessLevel = json.defaultAccess;
}

function scheduleDebouncedRecompute(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        recompute();
    }, 200);
}

function startWatch(): void {
    if (watchHandle) {
        watchHandle.close();
        watchHandle = null;
    }
    const fp = resolveFileAccessJsonPath();
    const dir = path.dirname(fp);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        /* ignore */
    }

    const onEvent = (): void => {
        scheduleDebouncedRecompute();
    };

    try {
        if (fs.existsSync(fp)) {
            watchHandle = fs.watch(fp, onEvent);
        } else {
            watchHandle = fs.watch(dir, onEvent);
        }
    } catch {
        try {
            watchHandle = fs.watch(dir, onEvent);
        } catch {
            /* 无监听权限时仍可用，仅失去热重载 */
        }
    }
}

/** 首次使用前初始化策略并启动对 file-access.json（或其目录）的监听 */
export function ensureFileAccessPolicyReady(): void {
    if (ready) return;
    recompute();
    startWatch();
    ready = true;
}

/** Web 或其它进程写入 JSON 后立即刷新，并重新挂载监听 */
export function reloadFileAccessPolicyAfterFileWrite(): void {
    recompute();
    if (ready) {
        startWatch();
    }
}

export function getFileAccessRoots(): string[] {
    ensureFileAccessPolicyReady();
    return roots.slice();
}

export function getFileAccessDeniedPrefixes(): string[] {
    ensureFileAccessPolicyReady();
    return denied.slice();
}

export function getPathRules(): { path: string; access: PathAccessLevel }[] {
    ensureFileAccessPolicyReady();
    return pathRules.map((r) => ({ ...r }));
}

export function getDefaultAccessLevel(): PathAccessLevel {
    ensureFileAccessPolicyReady();
    return defaultAccessLevel;
}

/**
 * 路径是否在允许根内且未被拒绝前缀覆盖（不检查 pathRules 级别）
 */
export function isPathGloballyAllowed(resolvedAbs: string): boolean {
    ensureFileAccessPolicyReady();
    const cand = path.resolve(resolvedAbs);
    const allowed = roots.some((r) => isPathInsideRoot(r, cand));
    if (!allowed) return false;
    for (const d of denied) {
        if (isPathInsideRoot(d, cand)) return false;
    }
    return true;
}

/**
 * 在已通过全局允许的前提下，返回路径的有效访问级别（最长 pathRules 前缀匹配，否则 defaultAccess）
 */
export function getPathAccessLevel(resolvedAbs: string): PathAccessLevel {
    ensureFileAccessPolicyReady();
    const cand = path.resolve(resolvedAbs);
    let best: { len: number; access: PathAccessLevel } | null = null;
    for (const rule of pathRules) {
        const rp = path.resolve(rule.path);
        if (isPathInsideRoot(rp, cand) || cand === rp) {
            const len = rp.length;
            if (!best || len > best.len) {
                best = { len, access: rule.access };
            }
        }
    }
    return best?.access ?? defaultAccessLevel;
}

export function assertPathOperationAllowed(
    resolvedAbs: string,
    displayPath: string,
    op: "read" | "write" | "delete",
): void {
    const cand = path.resolve(resolvedAbs);
    if (!isPathGloballyAllowed(cand)) {
        throw new Error(`路径不在允许范围内或位于拒绝前缀下: ${displayPath}`);
    }
    const level = getPathAccessLevel(cand);
    if (op === "read") {
        return;
    }
    if (op === "write") {
        if (level === "read") {
            throw new Error(`路径为只读，不允许写入或创建: ${displayPath}`);
        }
        return;
    }
    if (op === "delete") {
        if (level !== "full") {
            throw new Error(`路径需 full 权限才能删除（当前策略: ${level}）: ${displayPath}`);
        }
    }
}

/** 仅来自 .env 的额外根与拒绝前缀（供 API 展示） */
export function getEnvOnlyFileAccessParts(): { extraRoots: string[]; deniedPrefixes: string[] } {
    return {
        extraRoots: pathListFromEnv("ONECLAW_FILE_ACCESS_EXTRA_ROOTS"),
        deniedPrefixes: pathListFromEnv("ONECLAW_FILE_ACCESS_DENIED_PREFIXES"),
    };
}

/** 从磁盘解析的 JSON 业务字段（不含 raw） */
export function readFileAccessJsonFile(): {
    extraRoots: string[];
    deniedPrefixes: string[];
    pathRules: { path: string; access: PathAccessLevel }[];
    defaultAccess: PathAccessLevel;
} {
    const j = loadJsonOverlayFromDisk();
    return {
        extraRoots: j.extraRoots,
        deniedPrefixes: j.deniedPrefixes,
        pathRules: j.pathRules,
        defaultAccess: j.defaultAccess,
    };
}

/** 读取原始文本供 Web 编辑；文件不存在则返回默认模板 */
export function readFileAccessJsonRaw(): { filePath: string; raw: string; exists: boolean } {
    const filePath = resolveFileAccessJsonPath();
    const defaultObj = {
        extraRoots: [] as string[],
        deniedPrefixes: [] as string[],
        pathRules: [] as { path: string; access: PathAccessLevel }[],
        defaultAccess: "full" as PathAccessLevel,
    };
    if (!fs.existsSync(filePath)) {
        return {
            filePath,
            raw: `${JSON.stringify(defaultObj, null, 2)}\n`,
            exists: false,
        };
    }
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return { filePath, raw, exists: true };
    } catch {
        return {
            filePath,
            raw: `${JSON.stringify(defaultObj, null, 2)}\n`,
            exists: false,
        };
    }
}
