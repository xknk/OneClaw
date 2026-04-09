# OneClaw 实施进度备忘（M1–M4）

> **维护说明**：日常请以根目录 [`进度与规划.md`](../../进度与规划.md) 为交付状态入口；本文件为历史工程快照，保留作细节索引。

> 目的：在对话上下文变长或换人接手时，仍能快速对齐「已做什么 / 待做什么」。  
> 权威产品范围仍以 `prd.md`、`prd-v2.md`、`prd-v3.md` 为准；本文是**工程落地快照**。

**最近整理日期**：2026-04-01

---

## 1. 与 PRD 的对应关系

| 阶段 | PRD 文档 | 工程主题 |
|------|-----------|----------|
| M1 | `prd-v3.md` §6 M1 / FR-1 | 测试 + CI + 启动烟测 |
| M2 | `prd-v3.md` §6 M2 / FR-2 | 工具 Provider、注册、执行治理、MCP stdio |
| M3 | `prd-v3.md` §6 M3 / FR-3 | Trace 事件、落盘、CLI 查询/回放 |
| M4 | `prd-v3.md` §6 M4 / FR-4 | 路径/exec 策略、审计脱敏、使用说明与风险文档 |

---

## 2. M1（质量基线）— 状态：**已完成**

### 2.1 交付物

- **单测**：`runAgent`、`policy`、`loadSkills`、`resolveAgentId`、`withSkills`、`ToolRegistry`、`ToolExecutionService`、`mcpProvider`、`mcpConfig`、`traceWriter`、`toolExecutionTrace`、`providerHealth` 等见 `tests/*.test.ts`。
- **脚本**：`package.json` 中 `typecheck`、`test`、`smoke`、`ci`、`trace`（CLI）。
- **烟测**：`scripts/smoke-server.ts`。
- **CI**：`.github/workflows/ci.yml`（`typecheck` + `test` + `smoke`）。

### 2.2 已知注意点

- **Vitest 4 + Node 18**：曾出现 `node:util` 无 `styleText`；当前仓库为 **Vitest 3.x**，或需 Node 20+。
- **`loadSkills` 测试**：宜 **mock `fs/promises`**，避免对内部闭包错误 `spyOn`。
- **`pnpm run ci`**：需上述脚本齐全。

---

## 3. M2（工具生态化）— 状态：**已完成（MCP 依赖本机配置与网络）**

### 3.1 架构要点（当前代码）

- **`ToolRegistry`**：`src/tools/registry.ts` — 多 Provider、优先级合并；可选 **`ProviderHealth`** 熔断。
- **`ToolExecutionService`**：`src/tools/executionService.ts` — `toolGuard`、超时、`retry`、`trace`、`onFinished` 等。
- **Providers**
  - `builtinProvider`：`src/tools/providers/builtinProvider.ts`
  - `createRuntimeSkillProvider`：`src/tools/providers/runtimeSkillProvider.ts`
  - **MCP**：`createMcpProvider`（`src/tools/providers/mcpProvider.ts`）+ **`RoutingMcpSdkClient`**（`src/tools/mcpSdkClient.ts`，`@modelcontextprotocol/sdk` stdio）+ **`getMcpProvidersForRegistry`**（`src/tools/mcpRegistry.ts`）
- **配置**：`src/config/mcpConfig.ts` — `ONECLAW_MCP_SERVERS`（JSON 数组）或 `ONECLAW_MCP_SERVERS_FILE`（文件路径）；无配置时 **不向注册表注册任何 MCP**（不再依赖占位 stub）。
- **占位 stub**：`src/tools/mcpClient.ts` — 仅保留兼容/测试引用。
- **主链路**：`src/server/chatProcessing.ts` — `getMcpProvidersForRegistry()` → `createRegistryWithProviders([...mcpProviders, runtimeSkill, builtin])` → `runAgent(..., executeTool)`。

### 3.2 行为约定（便于排障）

- **自动重试**：由 `ToolExecutionService` 与 `riskLevel` / `retryPolicy` 决定。
- **熔断**：`chatProcessing.ts` 内进程级 **单例** `providerHealth`。
- **`doctor`**：`src/cli/doctor.ts` 会提示是否加载到 MCP 配置条目。

### 3.3 MCP 使用提示

- 需本机可执行 `npx` / `uvx` 等（与 JSON 里 `command` / `args` 一致）；首次 `npx -y` 拉包可能较慢。
- **`allowedToolNames`**：建议生产环境显式列举；与 Agent 内置白名单、profile 叠加生效。
- 快速试通可选用官方 npm **`@modelcontextprotocol/server-filesystem`**，在 `args` 末尾传入允许访问的目录路径（详见包 README）。

### 3.4 待办 / 可选增强

- [ ] 将 trace 目录解析逻辑统一到单模块（`traceQuery` 与 `traceWriter` 仍各自拼路径，行为已对齐 `appConfig`）。
- [ ] MCP：Streamable HTTP / SSE 远端（当前仅 **stdio**）。
- [ ] 可选：`RoutingMcpSdkClient` 的集成单测（需 mock SDK 或子进程）。

---

## 4. M3（可观测与回放）— 状态：**已完成（增强项可选）**

### 4.1 已实现

- **类型**：`src/observability/traceTypes.ts`
- **落盘**：`src/observability/traceWriter.ts` — JSONL，`userWorkspaceDir/logs/trace/trace-YYYY-MM-DD.jsonl`
- **查询**：`src/observability/traceQuery.ts` — 按 `traceId`、时间窗等
- **CLI**：`src/cli/trace.ts`（`trace dir | get | failed | slow` 等）+ `src/cli.ts` 已 `registerTraceCommands`
- **埋点**：`chatProcessing`、`runAgent`（`onModelEvent`）、`ToolExecutionService` 等经 `emitTrace` 写入

### 4.2 验收示例

```bash
pnpm cli trace dir
pnpm cli trace get --id <响应 metadata 中的 traceId>
```

### 4.3 后续（非阻塞）

- [ ] Trace **人类可读摘要**（除 JSON 外按阶段一行）
- [ ] **HTTP API** 查询（与 CLI 并存）
- [ ] 日志 **轮转/保留策略**

---

## 5. M4（安全增强与文档）— 状态：**工程已落地；可持续加固**

- **路径 / exec**：`src/security/pathPolicy.ts`、`src/security/execPolicy.ts` 与 `src/security/policy.ts`（profile 含 `pathAllowlistPrefixes`、`pathDenylistPatterns`、`execForbiddenSubstrings` 等）。
- **工具守卫**：`src/security/toolGuard.ts`（由 `policy` / 执行链引用）。
- **审计脱敏**：`src/security/auditSanitize.ts`（如 `ToolExecutionService` 写 trace 前处理参数）。
- **用户文档**：`docs/user-guide.md`（含 MCP env 示例）、`docs/security-risks.md`。

### 5.1 可选后续

- [ ] PRD 所述「拒绝原因与审计字段」进一步与前端/模型展示字段统一命名
- [ ] 更完整的运维手册（部署、备份、日志权限）

---

## 6. 关键文件索引（便于搜索）

| 领域 | 路径 |
|------|------|
| 统一聊天 | `src/server/chatProcessing.ts` |
| Agent 循环 | `src/agent/runAgent.ts` |
| 工具执行 | `src/tools/executionService.ts` |
| 注册表 | `src/tools/registry.ts` |
| MCP 注册 / SDK 客户端 | `src/tools/mcpRegistry.ts`、`src/tools/mcpSdkClient.ts` |
| MCP 配置 | `src/config/mcpConfig.ts` |
| 熔断 | `src/tools/providerHealth.ts` |
| Trace | `src/observability/traceTypes.ts`、`traceWriter.ts`、`trace.ts`、`traceQuery.ts` |
| Trace CLI | `src/cli/trace.ts` |
| CLI 入口 | `src/cli.ts` |
| 安全策略 | `src/security/policy.ts`、`pathPolicy.ts`、`execPolicy.ts`、`toolGuard.ts`、`auditSanitize.ts` |
| 测试 | `tests/*.test.ts` |
| CI | `.github/workflows/ci.yml` |
| 使用与风险 | `docs/user-guide.md`、`docs/security-risks.md` |

---

## 7. 变更记录

- **2026-03-28**：初稿（M1–M3）。
- **2026-04-01**：同步 M2 MCP（stdio + env 配置）、M3 CLI/单测现状、M4 安全与文档、文件索引与待办刷新。
