# OneClaw 使用说明（简要）

文档索引（步骤 1–4）见 [README](./README.md)。

## 安装与启动

1. 安装依赖：`pnpm install`
2. 复制环境变量示例：参考仓库内 `.env.example` 自建 `.env`（勿提交真实 token）
3. 启动网关：`pnpm dev` 或 `pnpm cli start`
4. 自检：`pnpm cli doctor`

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