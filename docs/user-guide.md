# OneClaw 用户指南

面向**安装、对话、任务与排障**。产品与交付状态见 [prd.md](./prd.md)；架构、安全与扩展见 [developer.md](./developer.md)。文档索引见 [README](./README.md)。

---

## 1. OneClaw 是什么？

OneClaw 是**跑在本机上的 AI 助手网关**：把大语言模型与受控工具（读文件、搜索、`apply_patch`、受控 `exec`、可选 **MCP** 等）接在一起，通过 **浏览器（WebChat）**、**终端 TUI** 或 **REPL** 使用。

| 概念 | 说明 |
|------|------|
| **Gateway** | HTTP 服务进程：提供 `/api/chat`、任务 API、Web 前端静态资源等；绑定地址由 `BIND_HOST` + `PORT` 决定。 |
| **统一对话链** | Web / REPL / TUI 最终都走 `handleUnifiedChat`（`src/server/chatProcessing.ts`），工具、Skills、任务上下文、审批逻辑一致。 |
| **Profile** | 安全策略档位（如 `webchat_default`）：与路径、exec、工具白名单等叠加，见 [developer.md](./developer.md)。 |

默认**仅本机访问**（`BIND_HOST` 默认 `127.0.0.1`）。若改为 `0.0.0.0` 即对局域网开放，务必配合 `WEBCHAT_TOKEN` 与网络边界评估。

---

## 2. 仓库与运行环境

本仓库为 **pnpm monorepo**：根目录含 `pnpm-workspace.yaml` 与根级 **`package.json`**。**`.env` 应放在 monorepo 根目录**（与 `pnpm-workspace.yaml` 同级）；服务端会向上查找该目录并加载 `.env`，业务上的「项目根」默认也是这里（`ONECLAW_PROJECT_ROOT_DIR`）。

| 需要 | 说明 |
|------|------|
| **Node.js** | 建议使用 **Current LTS**；安装后在新开终端执行 `node -v` 确认。 |
| **pnpm** | 本仓库脚本均按 pnpm 编写，例如 `npm install -g pnpm` 后 `pnpm -v`。 |
| **模型** | 至少一种后端：常见为本地 [Ollama](https://ollama.com/)（`OLLAMA_*`），或按你接入的提供方配置（以实际代码与 `.env.example` 为准）。 |

**常用根脚本**（在 monorepo 根执行）：

| 命令 | 作用 |
|------|------|
| `pnpm install` | 安装全部 workspace 依赖。 |
| `pnpm dev` | **同时**启动 `dev:server` + `dev:web`（热更新开发，适合调 Web）。 |
| `pnpm start` | 仅启动已构建的服务端（生产形态；需先 `pnpm build` 等，以你发布流程为准）。 |
| `pnpm cli …` | 等价 `pnpm --filter oneclaw-server cli …`，所有 `cli` 子命令走此入口。 |

---

## 3. 安装与配置

1. 进入 **monorepo 根目录**（含 `pnpm-workspace.yaml` 与根 `package.json`）。  
2. `pnpm install`  
3. 复制 **`.env.example`** 为 **`.env`**，按需填写（**勿**将含真实密钥的 `.env` 提交到 Git）。  
4. 建议执行：  
   ```bash
   pnpm cli onboard    # 初始化说明与目录提示  
   pnpm cli doctor     # 绑定、鉴权、模型、exec、MCP 等自检  
   ```

### 3.1 关键环境变量（与 `appConfig` 对齐）

下列与 `apps/server/src/config/evn.ts` 一致；完整列表以代码与 `.env.example` 为准。

#### 网关与访问

| 变量 | 默认 / 说明 |
|------|-------------|
| `PORT` | HTTP 端口，默认 `3000`。 |
| `BIND_HOST` | 默认 `127.0.0.1`；改为 `0.0.0.0` 可监听所有网卡（**局域网可访问**，需自行评估风险）。 |
| `WEBCHAT_TOKEN` | 非空时，访问 WebChat / 与 `/api/chat` 相同鉴权的 API 需携带令牌（见 §6）。 |

#### 模型（Ollama 示例）

| 变量 | 说明 |
|------|------|
| `OLLAMA_BASE_URL` | 如 `http://127.0.0.1:11434` |
| `OLLAMA_MODEL_NAME` | 本机已 `ollama pull` 的模型名 |
| `OLLAMA_STREAMING` | 是否流式（布尔） |
| `OLLAMA_TEMPERATURE` 等 | 采样与长度等参数 |

#### 数据与目录

| 变量 | 说明 |
|------|------|
| `ONECLAW_DATA_DIR` | 数据根目录，默认 **`~/.oneclaw`**（Windows 下为用户目录下 `.oneclaw`）。 |
| `ONECLAW_USER_WORKSPACE_DIR` | 用户工作区（文件工具主目录），默认 `{DATA_DIR}/workspace`。 |
| `ONECLAW_SKILLS_DIR` | Skills 与 `agents.json` 等，默认 `{项目根}/workspace`（`ONECLAW_PROJECT_ROOT_DIR` 参与解析）。 |
| `ONECLAW_PROJECT_ROOT_DIR` | 默认自动解析为含 `pnpm-workspace.yaml` 的目录。 |

#### 对话与摘要（部分）

| 变量 | 说明 |
|------|------|
| `ONECLAW_CHAT_CONTEXT_MAX_MESSAGES` | 发给模型的**最近消息条数**上限（默认 30）。 |
| `ONECLAW_CHAT_HISTORY_MAX_TOKENS` | 滚动摘要 + 原文尾部的 token 预算（默认 6000）。 |
| `ONECLAW_CHAT_ROLLING_MERGE_CHUNK` | 超 token 时单次折入摘要的条数上限（默认 15）。 |
| `ONECLAW_ROLLING_PREFETCH_ENABLED` | 是否在回复后后台预跑滚动摘要（默认 true）。 |

#### 工具与安全（部分）

| 变量 | 说明 |
|------|------|
| `ONECLAW_EXEC_ENABLED` | 是否允许 `exec` 工具（默认 true）。 |
| `ONECLAW_EXEC_TIMEOUT_MS` / `ONECLAW_EXEC_DENIED_PATTERNS` | 超时与禁止命令模式（正则，逗号分隔）。 |
| `ONECLAW_FETCH_URL_ENABLED` 等 | 内置 HTTP 出站能力；内网默认多受限（`ONECLAW_FETCH_ALLOW_PRIVATE_HOSTS`）。 |
| `ONECLAW_FILE_ACCESS_EXTRA_ROOTS` / `DENIED_PREFIXES` / `file-access.json` | 文件工具路径策略，见 `.env.example` 注释。 |

#### V4 任务

| 变量 | 说明 |
|------|------|
| `ONECLAW_TASK_HIGH_RISK_APPROVAL` | 默认 `true`：带 `taskId` 且任务为 `running` 时，`exec` / `apply_patch` 等可进入 `pending_approval`（见 §8）。 |
| `ONECLAW_M2_STEP_TOOL_ENFORCEMENT` | 默认 `true`：按计划步骤 `allowedTools` 强约束工具（Runner/Executor 侧）。 |

#### Trace 落盘

| 变量 | 说明 |
|------|------|
| `ONECLAW_TRACE_FILE_MAX_BYTES` | 单文件 JSONL 超过此大小则同日轮转 `trace-YYYY-MM-DD-partN.jsonl`（默认 64MB）。 |
| `ONECLAW_TRACE_RETENTION_DAYS` | 保留最近 N 天的 trace 文件（默认 30），更早的异步清理。 |

#### MCP

优先级（与注释一致）：**`ONECLAW_MCP_SERVERS_FILE` 存在则读该文件** → 否则 `ONECLAW_MCP_SERVERS` 内联 JSON → 否则 `{ONECLAW_DATA_DIR}/config/mcp-servers.json`。仓库内有示例 `workspace/config/mcp-servers.*.example.json`。

#### 其他

| 变量 | 说明 |
|------|------|
| `ONECLAW_UI_LOCALE` | `zh` / `en`，影响 TUI、Web 默认语言、摘要提示语等。 |
| `ONECLAW_QQ_BOT_*` | QQ 渠道（可选）。 |
| `ONECLAW_DAILY_REPORT_SCHEDULE_*` | 定时日报（可选）。 |

---

## 4. 三种使用方式

### 4.1 浏览器（网关 + 前端）

```bash
pnpm dev
```

- 终端会同时拉起 **server** 与 **web**（见根 `package.json` 的 `concurrently`）。  
- 浏览器地址一般为 **`http://127.0.0.1:<PORT>`**，`PORT` 默认 `3000`（以终端实际输出为准）。  
- 若仅调试 API、不需要前端，可改用在 `apps/server` 里单独跑 `dev`（高级用法，此处从略）。

### 4.2 终端 TUI（无需先 `pnpm dev`）

```bash
pnpm cli          # 无子命令时默认进入 TUI
pnpm cli tui
pnpm oneclaw      # 经 bin/oneclaw.cjs
```

| 项 | 说明 |
|----|------|
| **TTY** | 需要真实终端；建议高度 ≥ 25 行、宽度 ≥ 80 列。 |
| **WebSocket** | TUI 进程内起 WS，默认端口 **`18789`**；可用 **`ONECLAW_TUI_WS_PORT`** 或 **`pnpm cli tui -p <port>`** 修改。 |
| **退出** | **`/exit`** 或 **`Ctrl+C`**。 |

**Windows 下 `oneclaw` 无法识别**：优先用 `pnpm oneclaw` / `pnpm cli`；或执行 `pnpm setup` 修复 PATH 后 `pnpm link --global`；或 `node <仓库根>\bin\oneclaw.cjs`。

#### 界面与斜杠命令

- **顶栏**：项目名、版本、WS 地址、当前 `session`。  
- **聊天区**：用户行以 `>` 开头，助手以 `●` 开头。  
- **行首 `/`**：打开命令菜单；**↑/↓** 选择，**Tab** 补全，**Esc** 清空。  
- **普通对话**：行首不要误加 `/`，否则会被当成命令。

**常用斜杠命令**（实现以 `src/cli/slashCommands.ts` 与 `src/tui/` 为准，`/help` 最权威）：

| 命令 | 作用 |
|------|------|
| `/help`、`/?` | 帮助 |
| `/session <key>` | 切换会话键 |
| `/clear` | 清空本窗口显示（不删服务端持久化） |
| `/status` | 当前会话、模型、目录等摘要 |
| `/onboard` | 调用 `pnpm cli onboard` |
| `/doctor` | 调用 `pnpm cli doctor` |
| `/task …`、`/t …` | 透传 task 子命令 |
| `/trace …`、`/tr …` | 透传 trace 子命令 |
| `/start` | 提示需在独立终端启动 Gateway |
| `/exit` | 退出 TUI |

**重要**：TUI 内部分命令会在**子进程**执行 `pnpm cli …`，请在 **monorepo 根目录** 启动，否则可能找不到脚本。

**会话隔离**：`handleUnifiedChat` 与 Web/REPL 一致；**不要**与正在跑的 Web 端共用同一 `sessionKey`（建议 Web 用 `main`，终端用 `cli`），否则转录可能交错。

### 4.3 REPL（纯文本）

**无需**启动 `pnpm dev`。配置好 `.env` 后：

```bash
pnpm repl
pnpm cli repl
pnpm cli repl --session cli
pnpm cli repl --agent <id> --task <taskId>
pnpm cli repl -v             # stderr 打印 traceId / metadata，便于 trace get
```

| 内置命令（行首） | 作用 |
|------------------|------|
| `/help`、`/?` | 帮助 |
| `/session <key>` | 切换会话键 |
| `/clear` | 清屏（不删历史） |
| `/status` | 当前 session / task / 目录与模型摘要 |
| 单独 `/` 回车 | 列出命令；行首 `/` + **Tab** 补全 |
| `/exit`、`/quit` | 退出；`Ctrl+C` 也可退出 |

**与网关并行**：同一 `ONECLAW_DATA_DIR` 且相同有效会话键时，转录可能交错 —— 建议 Web `main`、REPL 默认 `cli`。**MCP** 在网关进程与 CLI 进程各自连接，属正常现象。

---

## 5. 目录与数据

| 路径 / 变量 | 内容 |
|-------------|------|
| `ONECLAW_DATA_DIR` | 数据根（默认 `~/.oneclaw`）。 |
| `{DATA_DIR}/workspace` | 默认用户工作区（可被 `ONECLAW_USER_WORKSPACE_DIR` 覆盖）。 |
| `{DATA_DIR}/tasks/*.json` | 任务单据（V4）。 |
| `{DATA_DIR}/tasks/tasks-index.json` | 任务列表索引（若存在）。 |
| `{DATA_DIR}/config/` | `mcp-servers.json`、`file-access.json`、`policy-overrides.json` 等（按功能启用）。 |
| `{userWorkspaceDir}/logs/trace/` | Trace JSONL：`trace-YYYY-MM-DD.jsonl`（过大时同日前缀 `partN`）。 |
| `ONECLAW_SKILLS_DIR` | Skills JSON、`agents.json` 等（默认仓库根下 `workspace`）。 |

---

## 6. WebChat 与鉴权

- 若 **`WEBCHAT_TOKEN` 为空**：开发环境常见为**不校验**（仍以你当前版本行为为准，`doctor` 会提示风险）。  
- 若 **非空**：请求需携带  
  - **`Authorization: Bearer <token>`**，或  
  - Query **`?token=<token>`**（与具体路由实现一致）。  

所有与 WebChat **相同鉴权** 的 HTTP API（如 `/api/chat`、§8 任务 API）均使用同一套规则。

---

## 7. Trace 诊断

Trace 为 **JSONL** 事件流，按 `traceId` 串联；`pnpm cli repl -v` 或 Web 响应 metadata 中可拿到 `traceId`。

### 7.1 常用命令

| 子命令 | 作用 |
|--------|------|
| `pnpm cli trace dir`（别名 `path`） | 打印 trace 日志目录绝对路径。 |
| `pnpm cli trace get <traceId>` | 输出该 `traceId` 的完整事件数组（JSON）。` -i <id>` 等价；**`-d <n>`** 扫描最近 **n 个日历日** 的文件（默认 14，最大 90）。 |
| `pnpm cli trace failed` | 列出最近失败类事件（`tool.failed`、`tool.denied`、`llm.error` 等）。**`-S 24h`**（或 `1d`、`30m`）时间窗；**`-t`** 按 tool 名过滤；**`-e`** 按 `errorCode`；**`-d`** 扫描天数。 |
| `pnpm cli trace slow` | 按 `tool.execute.end` 的 `durationMs` 取最慢 Top N；**`-S`**、**`-n`**、**`-d`**。 |
| `pnpm cli trace replay <traceId>` | **可读时间线摘要**（非重放执行）；**`-j`** 输出 JSON。 |

示例：

```bash
pnpm cli trace dir
pnpm cli trace get -i <traceId> -d 7
pnpm cli trace failed --since 24h --tool exec
pnpm cli trace replay <traceId>
```

未找到 `traceId` 时，请确认 **`ONECLAW_DATA_DIR`** 与扫描 **`-d` 天数**；日志轮转后同日多文件时，查询逻辑会按实现扫描多段文件。

---

## 8. V4 任务工作流（Task）

任务单据在 **`{ONECLAW_DATA_DIR}/tasks/*.json`**，含状态机、时间线、`meta.v4_plan`、`meta.v4_last_review`、`meta.v4_pending_approval` 等。

### 8.1 环境变量

| 变量 | 说明 |
|------|------|
| `ONECLAW_TASK_HIGH_RISK_APPROVAL` | 默认 `true`。WebChat 请求带 `taskId` 且任务为 `running` 时，`exec` / `apply_patch` 可先进入 **`pending_approval`**，需人工 **`approve`** 后由用户/模型**再次发起**同一类工具调用。仅开发调试可设为 `false`。 |

### 8.2 WebChat 关联任务

`POST /api/chat` 请求体可增加：

- **`taskId`**（字符串）：关联已有任务；转录 session 内部为 **`task:<taskId>`**，与纯 `sessionKey` 对话隔离；**多任务并行请使用不同 `taskId`**。  
- **`sessionKey`**：仍用于 Skills 匹配等；与 `taskId` 同时存在时，以任务隔离规则为准（见 `chatProcessing`）。

### 8.3 HTTP API（均需与 `/api/chat` 相同鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tasks` | 创建；`templateId`：`fix_bug` / `code_review` / `daily_report` / `release_precheck`；`params`、`meta` |
| `GET` | `/api/tasks` | 列表；`limit`、`status`、`failedOnly` |
| `GET` | `/api/task-templates` | 内置模板列表 |
| `GET` | `/api/tasks/:taskId` | 详情 |
| `GET` | `/api/tasks/:taskId/export?format=json` 或 `md` | 导出报告 |
| `POST` | `/api/tasks/:taskId/transition` | 状态迁移，`body.to` 为合法 `TaskStatus` |
| `POST` | `/api/tasks/:taskId/plan` | Planner 提交计划，`body.steps` 为数组 |
| `POST` | `/api/tasks/:taskId/review` | Reviewer；仅 `review` 态；`body.outcome`：`pass` / `fail` |
| `POST` | `/api/tasks/:taskId/approve` | `pending_approval` → `running`；可选 `body.comment` |
| `POST` | `/api/tasks/:taskId/cancel`、`retry`、`resume`、`note` | 见路由实现 |

高风险工具被拦截后，客户端对同一任务调用 **`approve`** 后，再**重试**工具调用以继续。

### 8.4 CLI

`task` 可写成 `t`，`trace` 可写成 `tr`；任务 ID / traceId 可放在子命令后作位置参数。

```bash
pnpm tasks
pnpm cli task tpl
pnpm cli task create "标题" -T fix_bug
pnpm cli task ls -n 20 -f
pnpm cli task get <taskId>
pnpm cli t transition <taskId> running
pnpm cli task plan <taskId> plan.json
pnpm cli task review <taskId> --pass -m "LGTM"
pnpm cli task approve <taskId> -c "批准执行"
pnpm cli task export <taskId> -f md -o report.md
pnpm cli tr dir
pnpm cli trace get <traceId> -d 7
```

`pnpm cli --help` 文末有「快捷写法」摘要。

---

## 9. 附录：终端能力对标（参考）

信息来自公开资料，**不保证与闭源产品逐条一致**，仅作对标与排期参考。

### OpenClaw（TUI + Gateway）

| 能力 | OneClaw 现状（摘要） |
|------|----------------------|
| TUI + WS | 有本机 WS + Ink，端口默认可配 |
| 流式输出 | **无**（多整段返回） |
| 历史加载、多行输入、丰富快捷键 | **无或简化** |
| 会话 | `sessionKey` + 可选 `taskId` |

### Claude Code（CLI）

| 能力 | OneClaw 现状（摘要） |
|------|----------------------|
| 单命令 `oneclaw` | 可用 `pnpm link --global` 后 `oneclaw` |
| 斜杠命令 | REPL/TUI 有部分；**无**完整 `/compact`、`/cost` 等 |
| `doctor` | 有 `pnpm cli doctor` |

---

## 10. 附录：REPL 实现（开发者）

- **核心**：每轮 `handleUnifiedChat`（`src/server/chatProcessing.ts`），与 HTTP `POST /api/chat` 一致。  
- **代码**：`src/cli/repl.ts`（`runRepl`）、`src/cli.ts`（`repl` 子命令）。  
- **CLI 入站字段**：`channelId` 为 `webchat` 类、`channelUserId` 固定 `cli-local` 等（与实现一致）。  
- **阶段 C（未做）**：流式、多行输入、↑ 历史等 —— 见 [prd.md](./prd.md) §5.3。

---

## 11. 常见问题（排障）

| 现象 | 建议 |
|------|------|
| `doctor` 报模型不可用 | 检查 Ollama 是否启动、`OLLAMA_BASE_URL` / `OLLAMA_MODEL_NAME` 是否与本机一致。 |
| Web 打不开 / 连接被拒绝 | 确认 `pnpm dev` 是否成功、`PORT` 是否被占用；防火墙仅在你绑定非 loopback 时相关。 |
| 工具总被拒绝 | 查 Profile、任务 `allowedTools`、Agent 白名单、MCP `allowedToolNames`；见 [developer.md](./developer.md)。 |
| 找不到 trace | 确认 `ONECLAW_DATA_DIR`；`trace get` 增大 **`-d`**；用 `trace dir` 看目录。 |
| TUI 布局错乱 | 放大终端窗口；避免后台向同一终端 stdout 打大量日志。 |
