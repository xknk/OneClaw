import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigDir } from "@/config/runtimePaths";
import { ollamaConfig, zhipuConfig } from "@/config/evn";

const ModelDriverSchema = z.enum(["ollama", "zhipu"]);
export type ModelDriver = z.infer<typeof ModelDriverSchema>;

const ModelEntrySchema = z.object({
    /** 前端选择用的稳定 id */
    id: z.string().min(1),
    /** 展示名 */
    label: z.string().min(1),
    /** 驱动类型：决定走哪个 Provider */
    driver: ModelDriverSchema,
    /** 覆盖：不同模型可不同 baseUrl/modelName */
    baseUrl: z.string().min(1),
    modelName: z.string().min(1),
    /** 可选：从 env 覆盖 baseUrl / modelName（优先级高于 baseUrl/modelName） */
    baseUrlEnv: z.string().optional(),
    modelNameEnv: z.string().optional(),
    /** 可选：仅智普需要；也允许写死在文件里（会在对外接口中脱敏） */
    apiKey: z.string().optional(),
    /** 可选：从 env 取 key（优先级高于 apiKey） */
    apiKeyEnv: z.string().optional(),
    /** 可选：提示前端该模型是否建议用于工具调用（不强制，执行时仍会失败并返回错误） */
    supportsTools: z.boolean().optional(),
    /** 可选：温度等通用参数（当前仅少量 Provider 使用；不存在则用 env 默认） */
    temperature: z.number().min(0).max(2).optional(),
    /** 可选：从 env 覆盖 temperature（优先级高于 temperature） */
    temperatureEnv: z.string().optional(),
}).strict();

const ModelCatalogSchema = z.object({
    version: z.literal(1),
    defaultModelId: z.string().min(1),
    models: z.array(ModelEntrySchema).min(1),
}).strict();

export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
export type ResolvedModelRuntime = {
    id: string;
    label: string;
    driver: ModelDriver;
    baseUrl: string;
    modelName: string;
    temperature?: number;
    apiKey?: string;
    supportsTools: boolean;
    /** 该模型实际用到的 env 变量名（便于 CLI/诊断输出） */
    envRefs: { baseUrlEnv?: string; modelNameEnv?: string; apiKeyEnv?: string; temperatureEnv?: string };
};

let _cache: { filePath: string; mtimeMs: number; catalog: ModelCatalog } | null = null;
let _watch: { dir: string; base: string; close: () => void } | null = null;
let _watchDebounce: NodeJS.Timeout | null = null;

export function getModelsFilePath(): string {
    const env = process.env.ONECLAW_MODELS_FILE?.trim();
    if (env) return path.resolve(env);
    return path.join(getConfigDir(), "models.json");
}

function ensureModelsWatcher(): void {
    const filePath = getModelsFilePath();
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);

    // watcher 已经指向当前目录与文件名，无需重复建立
    if (_watch && _watch.dir === dir && _watch.base === base) return;

    // 关闭旧 watcher
    try {
        _watch?.close();
    } catch {
        /* ignore */
    }
    _watch = null;

    // 监听目录：兼容文件不存在->创建、rename、原子写入（tmp+rename）等场景
    try {
        const watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
            const name = typeof filename === "string" ? filename : "";
            if (name && name !== base) return;
            if (_watchDebounce) clearTimeout(_watchDebounce);
            _watchDebounce = setTimeout(() => {
                invalidateModelsCatalogCache();
            }, 50);
        });
        _watch = {
            dir,
            base,
            close: () => watcher.close(),
        };
    } catch {
        // 某些环境下 fs.watch 可能失败；不影响功能，仍会靠 stat(mtime) 兜底刷新
        _watch = null;
    }
}

function defaultCatalogFromEnv(): ModelCatalog {
    const models: ModelEntry[] = [];
    if (zhipuConfig.baseUrl.trim() && zhipuConfig.modelName.trim()) {
        models.push({
            id: "zhipu",
            label: `智谱（${zhipuConfig.modelName}）`,
            driver: "zhipu",
            baseUrl: zhipuConfig.baseUrl,
            modelName: zhipuConfig.modelName,
            apiKeyEnv: "ZHIPU_API_KEY",
            supportsTools: true,
            temperature: zhipuConfig.temperature,
        });
    } else {
        // 即便没配好，也给一个入口，方便用户后续通过 models.json 填齐
        models.push({
            id: "zhipu",
            label: "智谱（未配置）",
            driver: "zhipu",
            baseUrl: zhipuConfig.baseUrl || "https://open.bigmodel.cn/api/paas/v4",
            modelName: zhipuConfig.modelName || "glm-4.5",
            apiKeyEnv: "ZHIPU_API_KEY",
            supportsTools: true,
            temperature: zhipuConfig.temperature,
        });
    }
    models.push({
        id: "ollama",
        label: `Ollama（${ollamaConfig.modelName}）`,
        driver: "ollama",
        baseUrl: ollamaConfig.baseUrl,
        modelName: ollamaConfig.modelName,
        supportsTools: true,
        temperature: ollamaConfig.temperature,
    });
    return {
        version: 1,
        defaultModelId: models[0]?.id ?? "zhipu",
        models,
    };
}

export function readModelsCatalogRaw(): { filePath: string; exists: boolean; rawText: string | null } {
    const filePath = getModelsFilePath();
    ensureModelsWatcher();
    if (!fs.existsSync(filePath)) {
        return { filePath, exists: false, rawText: null };
    }
    return { filePath, exists: true, rawText: fs.readFileSync(filePath, "utf-8") };
}

export function parseModelsCatalog(input: unknown): ModelCatalog {
    const parsed = ModelCatalogSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error(`models.json 格式错误：${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
    const { models, defaultModelId } = parsed.data;
    const ids = new Set(models.map((m) => m.id));
    if (!ids.has(defaultModelId)) {
        throw new Error("models.json 格式错误：defaultModelId 必须在 models 中出现");
    }
    return parsed.data;
}

export function loadModelsCatalog(): ModelCatalog {
    const filePath = getModelsFilePath();
    ensureModelsWatcher();
    if (!fs.existsSync(filePath)) {
        return defaultCatalogFromEnv();
    }
    const st = fs.statSync(filePath);
    if (_cache && _cache.filePath === filePath && _cache.mtimeMs === st.mtimeMs) {
        return _cache.catalog;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw) as unknown;
    const catalog = parseModelsCatalog(json);
    _cache = { filePath, mtimeMs: st.mtimeMs, catalog };
    return catalog;
}

export function invalidateModelsCatalogCache(): void {
    _cache = null;
}

export function listModelsForClient(): { defaultModelId: string; models: Array<Pick<ModelEntry, "id" | "label" | "driver" | "supportsTools">> } {
    const cat = loadModelsCatalog();
    return {
        defaultModelId: cat.defaultModelId,
        models: cat.models.map((m) => ({
            id: m.id,
            label: m.label,
            driver: m.driver,
            supportsTools: Boolean(m.supportsTools ?? true),
        })),
    };
}

export function resolveModelEntry(modelId: string | undefined | null): { modelId: string; entry: ModelEntry } {
    const cat = loadModelsCatalog();
    const id = (modelId && String(modelId).trim()) ? String(modelId).trim() : cat.defaultModelId;
    const entry = cat.models.find((m) => m.id === id) ?? cat.models.find((m) => m.id === cat.defaultModelId);
    if (!entry) {
        // 理论上不会发生（schema 保证 models 非空且 defaultModelId 存在）
        throw new Error("未找到可用模型配置");
    }
    return { modelId: entry.id, entry };
}

export function resolveZhipuApiKey(entry: ModelEntry): string {
    const envKey = entry.apiKeyEnv?.trim();
    if (envKey) {
        const v = process.env[envKey];
        if (v && String(v).trim()) return String(v).trim();
    }
    return (entry.apiKey ?? "").trim();
}

function readEnvStr(key: string | undefined): string | undefined {
    const k = key?.trim();
    if (!k) return undefined;
    const v = process.env[k];
    if (v == null) return undefined;
    const s = String(v).trim();
    return s ? s : undefined;
}

function readEnvNum(key: string | undefined): number | undefined {
    const s = readEnvStr(key);
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}

export function resolveModelRuntime(modelId: string | undefined | null): ResolvedModelRuntime {
    const { entry } = resolveModelEntry(modelId);
    const baseUrl = readEnvStr(entry.baseUrlEnv) ?? entry.baseUrl;
    const modelName = readEnvStr(entry.modelNameEnv) ?? entry.modelName;
    const temperature = readEnvNum(entry.temperatureEnv) ?? entry.temperature;
    const supportsTools = Boolean(entry.supportsTools ?? true);

    const apiKey =
        entry.driver === "zhipu"
            ? (() => {
                  const k = resolveZhipuApiKey(entry);
                  return k ? k : undefined;
              })()
            : undefined;

    return {
        id: entry.id,
        label: entry.label,
        driver: entry.driver,
        baseUrl,
        modelName,
        temperature,
        apiKey,
        supportsTools,
        envRefs: {
            baseUrlEnv: entry.baseUrlEnv?.trim() ? entry.baseUrlEnv.trim() : undefined,
            modelNameEnv: entry.modelNameEnv?.trim() ? entry.modelNameEnv.trim() : undefined,
            apiKeyEnv: entry.apiKeyEnv?.trim() ? entry.apiKeyEnv.trim() : undefined,
            temperatureEnv: entry.temperatureEnv?.trim() ? entry.temperatureEnv.trim() : undefined,
        },
    };
}

