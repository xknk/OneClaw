# OneClaw 文档（精简索引）

日常只需要按顺序读下面 **4 份** 即可；历史 PRD、路线图原文在 [`archive/`](./archive/README.md)。

| 步骤 | 文档 | 用途 |
|:---:|:---|:---|
| 1 | [使用说明](./user-guide.md) | 安装、启动、Trace、任务 API / CLI、环境变量 |
| 2 | [安全配置与风险](./security-risks.md) | Profile、exec、MCP、审计与建议 |
| 3 | [架构与扩展](./架构与扩展.md) | 模块边界、新增渠道 / Skill、条件启用技能 |
| 4 | [进度与规划](./进度与规划.md) | **已完成 vs 未完成**、可选增强、V5 方向 |

### 专项方案

| 文档 | 用途 |
|------|------|
| [终端交互-实施方案](./终端交互-实施方案.md) | 本机 REPL：**阶段 A+B 已落地**（用法见 [使用说明 · 终端对话](./user-guide.md#终端对话repl)） |

---

## 代码入口速查

| 主题 | 路径 |
|------|------|
| 统一聊天与任务上下文 | `src/server/chatProcessing.ts` |
| 终端 REPL | `src/cli/repl.ts` |
| TUI（Ink + WS） | `src/tui/`、`pnpm cli tui` |
| Agent 循环 | `src/agent/runAgent.ts` |
| 任务编排 / 步骤工具闸门 | `src/tasks/taskRunner.ts`、`src/tasks/stepToolPolicy.ts` |
| 任务与审批 | `src/tasks/taskService.ts`、`src/tasks/taskApproval.ts` |
| 工具与 MCP | `src/tools/` |
| Trace | `src/observability/`、`src/cli/trace.ts` |
| 安全策略 | `src/security/` |
| CI | `.github/workflows/ci.yml` |
