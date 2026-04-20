# 模型配置（models.json）与环境变量

本项目支持在 **Web 端** 与 **CLI** 里“傻瓜式”配置可选模型列表：本地 Ollama、线上智谱（Zhipu）以及后续可扩展的其它 Provider。

## 1. 配置文件位置（默认最直观）

- 默认：`ONECLAW_DATA_DIR/config/models.json`
- 可选覆盖：设置环境变量 `ONECLAW_MODELS_FILE` 指向任意路径（例如仓库内 `workspace/models.json`）

说明：Web「工作区」页会显示当前生效的 `models.json` 路径与是否已创建；未创建时点“保存”会自动创建。

## 2. Web 端（推荐）

打开 Web →「工作区」→「模型列表（models.json）」：

- 未创建：界面会提示“未创建”，点保存即可创建
- 已存在：直接编辑 JSON，点保存即可生效（服务端已支持热加载，无需重启）

## 3. CLI（指定根目录）

CLI 提供 `models` 子命令，支持把配置写到你指定的根目录（dataDir）下：

```bash
# 初始化：写入 <dataDir>/config/models.json（若已存在默认不覆盖）
pnpm -C apps/server run cli models init --data-dir "E:/oneclaw_data"

# 覆盖写入
pnpm -C apps/server run cli models init --data-dir "E:/oneclaw_data" --force

# 查看当前配置
pnpm -C apps/server run cli models get --data-dir "E:/oneclaw_data"

# 设置默认模型
pnpm -C apps/server run cli models set-default ollama-local --data-dir "E:/oneclaw_data"

# 打印各模型引用到的环境变量
pnpm -C apps/server run cli models env --data-dir "E:/oneclaw_data"
```

## 4. models.json 字段说明

顶层：

- **version**: 固定为 `1`
- **defaultModelId**: 默认模型 id（前端未显式选择时使用）
- **models**: 模型列表数组

每个模型（`models[]`）：

- **id**: 稳定 ID（前端下拉框传给后端的 `modelId`）
- **label**: 展示名
- **driver**: `ollama` 或 `zhipu`
- **baseUrl**: Provider API Base URL
- **modelName**: 模型名称（ollama 的 model / 智谱的 model）
- **supportsTools**（可选）: 是否建议用于工具调用（仅提示，不强制）
- **temperature**（可选）: 温度

环境变量引用（同一个网关进程内可以为不同模型引用不同 env 变量名）：

- **baseUrlEnv**（可选）: 若设置，则用 `process.env[baseUrlEnv]` 覆盖 `baseUrl`
- **modelNameEnv**（可选）: 若设置，则用 `process.env[modelNameEnv]` 覆盖 `modelName`
- **temperatureEnv**（可选）: 若设置，则用 `process.env[temperatureEnv]` 覆盖 `temperature`

智谱专用：

- **apiKey**（可选）: 直接写 key（不推荐；更建议用 env）
- **apiKeyEnv**（可选）: 若设置，则用 `process.env[apiKeyEnv]` 读取 key（优先级高于 `apiKey`）

## 5. 相关环境变量清单（建议写入 .env 或系统环境变量）

OneClaw 路径与运行：

- **ONECLAW_DATA_DIR**：数据根目录（默认 `~/.oneclaw`）
- **ONECLAW_MODELS_FILE**：覆盖 models.json 路径（可选）
- **WEBCHAT_TOKEN**：Web 访问鉴权 token（可选，启用后 Web/Workspace 需登录）

智谱（Zhipu）常用：

- **ZHIPU_API_KEY**：智谱 key（若 models.json 用 `apiKeyEnv: "ZHIPU_API_KEY"`）
- **ZHIPU_BASE_URL**、**ZHIPU_MODEL_NAME**：旧版兼容/默认值来源（未创建 models.json 时会生成默认目录）

Ollama 常用：

- **OLLAMA_BASE_URL**、**OLLAMA_MODEL_NAME**：旧版兼容/默认值来源（未创建 models.json 时会生成默认目录）
- **OLLAMA_CONNECT_TIMEOUT**：Ollama 请求超时（毫秒）。遇到 `This operation was aborted` 时可适当调大（如 180000）。

> 关键点：**`apiKeyEnv/baseUrlEnv/modelNameEnv/temperatureEnv` 只是“引用 env 变量名”**，不是把 key 存进去。环境变量必须在 OneClaw 进程启动时可见（修改系统环境变量后需重启终端/IDE，再重启服务进程）。

