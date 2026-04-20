import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
    getModelsFilePath,
    loadModelsCatalog,
    parseModelsCatalog,
    invalidateModelsCatalogCache,
    resolveModelRuntime,
} from "@/llm/modelCatalog";

async function ensureDir(p: string): Promise<void> {
    await fs.mkdir(p, { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
    await ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmp, filePath);
}

function applyScopedEnv(opts: { dataDir?: string; modelsFile?: string }): void {
    if (opts.dataDir?.trim()) {
        process.env.ONECLAW_DATA_DIR = opts.dataDir.trim();
    }
    if (opts.modelsFile?.trim()) {
        process.env.ONECLAW_MODELS_FILE = opts.modelsFile.trim();
    }
}

function defaultTemplateCatalog() {
    return {
        version: 1,
        defaultModelId: "zhipu",
        models: [
            {
                id: "zhipu",
                label: "智谱（线上）",
                driver: "zhipu",
                baseUrl: "https://open.bigmodel.cn/api/paas/v4",
                modelName: "glm-4.5",
                apiKeyEnv: "ZHIPU_API_KEY",
                supportsTools: true,
                temperature: 0.6,
            },
            {
                id: "ollama-local",
                label: "Ollama（本地）",
                driver: "ollama",
                baseUrl: "http://127.0.0.1:11434",
                modelName: "qwen2.5:3b",
                supportsTools: true,
                temperature: 0.3,
            },
        ],
    };
}

export function registerModelCommands(program: Command): void {
    const cmd = program.command("models").description("管理 models.json（可选模型列表）");

    cmd.command("path")
        .description("打印当前生效的 models.json 路径")
        .option("--data-dir <dir>", "临时指定 ONECLAW_DATA_DIR（仅本次命令）")
        .option("--models-file <file>", "临时指定 ONECLAW_MODELS_FILE（仅本次命令）")
        .action((opts: { dataDir?: string; modelsFile?: string }) => {
            applyScopedEnv(opts);
            console.log(getModelsFilePath());
        });

    cmd.command("get")
        .description("输出当前 models.json 的解析结果（JSON）")
        .option("--data-dir <dir>", "临时指定 ONECLAW_DATA_DIR（仅本次命令）")
        .option("--models-file <file>", "临时指定 ONECLAW_MODELS_FILE（仅本次命令）")
        .action((opts: { dataDir?: string; modelsFile?: string }) => {
            applyScopedEnv(opts);
            const cat = loadModelsCatalog();
            console.log(JSON.stringify(cat, null, 2));
        });

    cmd.command("init")
        .description("在指定根目录下初始化 models.json（不存在则创建；存在默认不覆盖）")
        .option("--data-dir <dir>", "指定 ONECLAW_DATA_DIR（将写入 <dataDir>/config/models.json）")
        .option("--models-file <file>", "直接指定 models.json 的绝对/相对路径")
        .option("--force", "若文件已存在则覆盖", false)
        .action(async (opts: { dataDir?: string; modelsFile?: string; force?: boolean }) => {
            applyScopedEnv(opts);
            const filePath = getModelsFilePath();
            if (!opts.force && fsSync.existsSync(filePath)) {
                console.log(`已存在：${filePath}`);
                console.log("（如需覆盖，使用 --force）");
                return;
            }
            const tpl = defaultTemplateCatalog();
            const parsed = parseModelsCatalog(tpl);
            await writeJsonAtomic(filePath, parsed);
            invalidateModelsCatalogCache();
            console.log(`已写入：${filePath}`);
        });

    cmd.command("set-default")
        .description("设置 defaultModelId（会写入 models.json）")
        .argument("<modelId>", "要设为默认的 modelId")
        .option("--data-dir <dir>", "临时指定 ONECLAW_DATA_DIR（仅本次命令）")
        .option("--models-file <file>", "临时指定 ONECLAW_MODELS_FILE（仅本次命令）")
        .action(async (modelId: string, opts: { dataDir?: string; modelsFile?: string }) => {
            applyScopedEnv(opts);
            const filePath = getModelsFilePath();
            const cat = loadModelsCatalog();
            const next = { ...cat, defaultModelId: modelId.trim() };
            const parsed = parseModelsCatalog(next);
            await writeJsonAtomic(filePath, parsed);
            invalidateModelsCatalogCache();
            console.log(`已更新 defaultModelId=${parsed.defaultModelId}`);
            console.log(`文件：${filePath}`);
        });

    cmd.command("env")
        .description("打印各模型引用到的环境变量（apiKeyEnv/baseUrlEnv/modelNameEnv/temperatureEnv）")
        .option("--data-dir <dir>", "临时指定 ONECLAW_DATA_DIR（仅本次命令）")
        .option("--models-file <file>", "临时指定 ONECLAW_MODELS_FILE（仅本次命令）")
        .action((opts: { dataDir?: string; modelsFile?: string }) => {
            applyScopedEnv(opts);
            const cat = loadModelsCatalog();
            console.log(`modelsFile: ${getModelsFilePath()}`);
            console.log(`defaultModelId: ${cat.defaultModelId}`);
            console.log("");
            for (const m of cat.models) {
                const rt = resolveModelRuntime(m.id);
                const refs = Object.entries(rt.envRefs).filter(([, v]) => Boolean(v));
                console.log(`- ${rt.id} (${rt.driver}) ${rt.label}`);
                if (refs.length === 0) {
                    console.log("  env: (none)");
                } else {
                    for (const [k, v] of refs) console.log(`  ${k}: ${v}`);
                }
            }
        });
}

