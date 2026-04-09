# OneClaw 使用说明（简要）

文档索引（步骤 1–4）见 [README](./README.md)。

## 安装与启动

1. 安装依赖：`pnpm install`
2. 复制环境变量示例：参考仓库内 `.env.example` 自建 `.env`（勿提交真实 token）
3. 启动网关：`pnpm dev` 或 `pnpm cli start`
4. 自检：`pnpm cli doctor`

## 终端对话（REPL）

**无需**启动 `pnpm dev`。在配置好 `.env`（模型等）后，直接在本机终端多轮对话，处理链与 WebChat 的 `POST /api/chat` 相同（`handleUnifiedChat`）。

```bash
pnpm repl                    # 同 pnpm cli repl
pnpm cli repl
pnpm cli repl --session cli  # 默认即为 cli，可与浏览器 main 区分
pnpm cli repl --agent <id> --task <taskId>
pnpm cli repl -v             # stderr 打印 traceId / metadata，便于 pnpm cli trace get
```

运行中：直接输入 `/help`、`/session <key>`、`/clear`、`/status`；单独输入 `/` 回车可列出命令；**行首输入 `/` 后按 Tab** 可补全命令。`/exit` 或 `/quit` 退出。

**注意**：若同时开网关与 REPL，勿让两边共用同一 `sessionKey` 写转录（建议 Web 用 `main`，REPL 用 `cli`）。详见 [终端交互-实施方案](./终端交互-实施方案.md) §5。

### TUI（类 OpenClaw 分栏终端）

需 **真实 TTY**（把终端窗口拉高一些）。本进程内会起 **WebSocket**（默认 `18789`，可用 `ONECLAW_TUI_WS_PORT` 或 `-p`），再用 **Ink** 画顶栏、消息区、输入行与底栏。

```bash
pnpm cli                    # 无子命令时默认进入 TUI（与下面等价）
pnpm oneclaw                # 同全局 oneclaw（走 bin/oneclaw.cjs，不依赖 PATH）
pnpm tui                    # 同 pnpm cli tui
pnpm cli tui --session cli
pnpm cli tui -p 18790       # 端口占用时换端口
```

**全局一条命令（类似 `claude`）**：在仓库根执行 `pnpm link --global` 后，终端里可直接运行 `oneclaw`（无参即 TUI），或 `oneclaw repl`、`oneclaw doctor` 等。入口脚本为 `bin/oneclaw.cjs`，依赖本仓库已 `pnpm install`。

**Windows 上提示「无法将 oneclaw 识别为 cmdlet」时**：说明当前 shell 的 PATH 里还没有 pnpm 的全局可执行目录。任选其一即可：

1. **不链全局（推荐先试）**：在仓库根用 `pnpm oneclaw` 或 `pnpm cli`（无子命令即 TUI）。
2. **链全局并修好 PATH**：在项目外执行一次 `pnpm setup`（会把 `PNPM_HOME` 写入用户环境变量），**关闭并重新打开**终端，再在仓库根执行 `pnpm link --global`，然后再试 `oneclaw`。
3. **临时调用**：`node 仓库根路径\bin\oneclaw.cjs`（无参即 TUI）。

对话链与 `repl` 相同（`handleUnifiedChat`）。**Ctrl+C** 退出。

与 OpenClaw / Claude Code 终端能力的对照与缺口，见 [参考-终端产品能力对照](./参考-终端产品能力对照.md)。

## 目录与数据

- `ONECLAW_DATA_DIR`：数据根目录（默认 `~/.oneclaw`）
- `ONECLAW_USER_WORKSPACE_DIR`：用户可写工作区（默认在 data 下）
- `ONECLAW_SKILLS_DIR`：Skills / `agents.json` 等（默认项目下 `workspace`）

## WebChat

- 若设置 `WEBCHAT_TOKEN`，访问需携带 Bearer 或 query token。

## Trace 诊断

```bash
pnpm cli trace dir
pnpm cli trace get --id <traceId>
pnpm cli trace failed --since 24h
```

## V4 任务工作流（Task）

任务单据保存在 `{ONECLAW_DATA_DIR}/tasks/*.json`，含状态机、时间线、结构化计划（`meta.v4_plan`）、评审结论（`meta.v4_last_review`）、待审批快照（`meta.v4_pending_approval`）等。

### 环境变量

| 变量 | 说明 |
|------|------|
| `ONECLAW_TASK_HIGH_RISK_APPROVAL` | 默认 `true`。WebChat 请求带 `taskId` 且任务为 `running` 时，`exec` / `apply_patch` 会先进入 `pending_approval`，需人工批准后再重试工具。设为 `false` 可关闭（仅建议开发调试）。 |

### WebChat 关联任务

`POST /api/chat` 请求体可增加：

- `taskId`（字符串）：关联已有任务。会启用 **按任务隔离的会话转录**（内部使用 `task:<taskId>` 作为 transcript 的 sessionKey），并在每轮向模型注入任务上下文（状态、计划摘录、时间线等）。
- 仍可通过 `sessionKey` 控制 Skills 匹配；转录存储键与纯 `sessionKey` 对话不同，**多任务并行**时请为不同任务使用不同 `taskId`。

### HTTP API（均需 WebChat 鉴权，与 `/api/chat` 相同）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tasks` | 创建任务；可传 `templateId`（`fix_bug` / `code_review` / `daily_report` / `release_precheck`）、`params`、`meta` |
| `GET` | `/api/tasks` | 列表；支持 `limit`、`status`、`failedOnly` |
| `GET` | `/api/task-templates` | 内置模板列表 |
| `GET` | `/api/tasks/:taskId` | 详情 |
| `GET` | `/api/tasks/:taskId/export?format=json` 或 `format=md` | 导出任务报告 |
| `POST` | `/api/tasks/:taskId/transition` | 状态迁移，`body.to` 为合法 `TaskStatus` |
| `POST` | `/api/tasks/:taskId/plan` | Planner 提交计划，`body.steps` 为数组 |
| `POST` | `/api/tasks/:taskId/review` | Reviewer 结论，仅 `review` 态；`body.outcome` 为 `pass` / `fail` |
| `POST` | `/api/tasks/:taskId/approve` | **M3** 人工批准，仅 `pending_approval` → `running`；可选 `body.comment` |
| `POST` | `/api/tasks/:taskId/cancel`、`retry`、`resume`、`note` | 见路由实现 |

高风险工具被拦截后，客户端可对同一任务调用 `approve`，令用户或助手 **再次发起** 相同工具调用以继续执行。

### CLI

`task` 可写成 `t`，`trace` 可写成 `tr`；任务 ID / traceId 可放在子命令后面（位置参数），不必写长 `--id`。

```bash
pnpm tasks                              # 等同 pnpm cli task list
pnpm cli task tpl                       # 模板列表（templates 别名）
pnpm cli task create "标题" -T fix_bug   # -T 模板；-t 为标题
pnpm cli task ls -n 20 -f               # list 别名 ls；-n 条数；-f 仅失败
pnpm cli task get <taskId>              # 或 task get -i <taskId>
pnpm cli t transition <taskId> running # 或 -i / -t 形式
pnpm cli task plan <taskId> plan.json   # 或 -f plan.json
pnpm cli task review <taskId> --pass -m "LGTM"
pnpm cli task approve <taskId> -c "批准执行"
pnpm cli task export <taskId> -f md -o report.md
pnpm cli tr dir                         # trace 日志目录（dir 别名 path）
pnpm cli trace get <traceId> -d 7      # -d 扫描天数
```

运行 `pnpm cli --help` 可查看文末「快捷写法」摘要。