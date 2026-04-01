# OneClaw 使用说明（简要）

## 安装与启动

1. 安装依赖：`pnpm install`
2. 复制环境变量示例（若有）或自建 `.env`
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