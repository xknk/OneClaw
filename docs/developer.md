# OneClaw 开发与扩展

面向**改代码、加渠道、配策略**的读者。安装与 CLI 见 [用户指南](./user-guide.md)；产品与交付状态见 [prd.md](./prd.md)。历史 PRD、Runner、Skills 工程长文见 [specs-archive.md](./specs-archive.md)。

---

## 1. 模块边界（速览）

| 模块 | 职责 | 边界要点 |
|------|------|----------|
| **Gateway** | HTTP、路由、鉴权、会话、调 Agent、写回 | 只认 `UnifiedInboundMessage` / `UnifiedOutboundMessage`，不解析各渠道原始协议细节 |
| **ChannelAdapter** | 入站解析、出站发送 | `parseInbound` / `sendOutbound`；当前有 WebChat、QQ（OneBot v11） |
| **Agent Runtime** | 多轮推理与工具循环 | 只依赖消息列表与 `ToolSchema[]` / `Tool[]` |
| **Tools** | 内置能力 + MCP + Runtime Skill | 经 `ToolRegistry` / `ToolExecutionService` 执行 |
| **Skills** | 工作区 JSON 技能包 | 提供额外 ToolSchema 与可选 `systemPrompt` |

### 1.1 配置加载

- **类型化配置**集中在 **`src/config/evn.ts`** 的 `appConfig`、`ollamaConfig`、`PORT` 等；业务代码应通过 **`appConfig`** 读取，避免散落 `process.env`。
- **`.env` 解析**：服务端启动时会向上查找 workspace 根并加载根目录 `.env`（见 `evn.ts` 中 `findWorkspaceRoot` + `dotenv`），**当前工作目录**下的 `.env` 可 override（`override: true`）。

### 1.2 新增渠道

1. 实现 **`ChannelAdapter`**：`channelId`、`parseInbound`、`sendOutbound`。  
2. 在网关创建/路由处注册：成功解析后走统一会话 + Agent，出站仍用同一 Adapter。  
3. **密钥**：单独环境变量（如 `ONECLAW_QQ_BOT_*`），文档中写明信任边界（DM/群、allowlist 等）。  
4. 参考：`src/server/` 中 WebChat / QQ 适配器的注册方式。

### 1.3 新增 / 使用 Skill

1. **目录**：默认 **`ONECLAW_SKILLS_DIR`**（指向 `workspace/skills` 一类路径），见 [用户指南](./user-guide.md) §5。  
2. **格式**：单个 Skill 对象，或 **`{ "skills": [ ... ] }`**；字段含 `id`、`tools`（ToolSchema 数组）、`systemPrompt` 等。  
3. **条件启用 `enableWhen`**（可选）：未配置则视为**全局启用**。配置后，仅当上下文命中规则时才注入工具与 `systemPrompt`。常见字段（以 `src/skills/types.ts` / `loadSkills.ts` 为准）：

| 字段 | 含义 |
|------|------|
| `channelIds` | 仅当 `channelId` 在列表中时启用 |
| `sessionKeyPrefixes` | `sessionKey` 以前缀匹配 |
| `keywordsAny` | 用户消息中**任一**关键词命中 |
| `agentIds` | 仅当 `agentId` 匹配 |

4. **加载与合并**：`loadSkillsForContext`、`getCombinedToolSchemasForContext`（`src/skills/loadSkills.ts`、`src/agent/withSkills.ts`）。  
5. **执行**：与内置工具**同名**可覆盖描述；**新工具名**必须在运行时有对应 **Tool** 实现，否则会报未知工具。

---

## 2. 安全配置与风险说明

### 2.1 权限如何叠加（重要）

以下**三层同时生效**，**任一拒绝**即调用失败（策略拒绝会写 trace / timeline，见 `toolGuard` / `ToolExecutionService`）：

| 层级 | 作用 |
|------|------|
| **Profile** | 如 `webchat_default`、`readonly`、`qq_group`：路径、exec、工具大类等（`src/security/policy.ts` 等）。 |
| **Agent 工具白名单** | 限制模型「可见」与可执行的**内置/部分**工具集合。 |
| **MCP `allowedToolNames`** | 在 MCP Provider 层收缩某个服务器暴露的工具名。 |

**外置策略覆盖**：若存在 **`{ONECLAW_DATA_DIR}/policy-overrides.json`**，会按 **profileId** 与合并规则覆盖各 profile 片段（实现见 `src/security/policyOverrides.ts`），便于部署时无改代码调参。

### 2.2 exec

- 总开关：**`ONECLAW_EXEC_ENABLED`**（`false` 则完全关闭）。  
- **默认拒绝模式**：`ONECLAW_EXEC_DENIED_PATTERNS` 为逗号分隔正则，命中则不执行（见 `appConfig.execDeniedPatterns`）。  
- **超时与输出**：`ONECLAW_EXEC_TIMEOUT_MS`、`ONECLAW_EXEC_MAX_OUTPUT_CHARS`（见 `evn.ts`）。  
- 仅在可信环境对高权限 profile 放行。

### 2.3 文件与 apply_patch

- 写入应限制在用户工作区；**额外允许根**、**禁止前缀**见 `.env` 中 `ONECLAW_FILE_ACCESS_*` 与可选 **`{DATA_DIR}/config/file-access.json`**（支持热重载时见注释）。  
- **`apply_patch`** 与高风险写路径在受限 profile 下可被拒绝。

### 2.4 MCP

- 子进程继承**合并后的环境变量**；密钥放在本机 `.env` 或 `mcp-servers.json` 的 `env` 字段，**勿提交**仓库。  
- **务必**配置 `allowedToolNames`（或等价约束），避免模型暴露过多工具。  
- **失败与熔断**：断连会重试；持续失败可触发 Provider 健康熔断（若启用）。  
- **配置优先级**：`ONECLAW_MCP_SERVERS_FILE` → `ONECLAW_MCP_SERVERS` → `{DATA_DIR}/config/mcp-servers.json`。

### 2.5 审计与 Trace

- JSONL 事件经 **`auditSanitize`** 等对参数脱敏后写入（见 `src/security/auditSanitize.ts`）。  
- 仍可能含用户提示片段，**控制** `{userWorkspaceDir}/logs` 与 `ONECLAW_DATA_DIR` 的目录权限。

### 2.6 建议

- 生产环境：**`WEBCHAT_TOKEN`**、只读或受限 profile、明确 MCP 白名单、按需关闭 exec。  
- **`BIND_HOST`** 为 `0.0.0.0` 时，视为网络暴露面，必须配合鉴权与防火墙策略。

---

## 3. 插件化边界（长文）

以下保留历史文档结构，便于 Phase 2+ 渠道与 Canvas 接入时对照；与 §1 重复的条目以 **§1 代码路径** 为准。

### 3.1 Gateway（控制面）

- **职责**：HTTP、路由、认证、会话解析、调用 Agent、写回响应。  
- **边界**：不直接解析各渠道原始协议细节；**ChannelAdapter** 产出 `UnifiedInboundMessage`，出站为 `UnifiedOutboundMessage`。

### 3.2 ChannelAdapter（渠道适配层）

- **入站**：`parseInbound(raw) => UnifiedInboundMessage | null`。  
- **出站**：`sendOutbound(target, message) => Promise<void>`。  
- **当前**：WebChat、QQ（OneBot v11）。

### 3.3 统一消息模型

- **入站**：`UnifiedInboundMessage`（`channelId`、`channelUserId`、`sessionKey`、`text`、`agentId`、`taskId` 等）。  
- **出站**：`UnifiedOutboundMessage`（`text`、`metadata`（含 `traceId` 等））。

### 3.4 Agent Runtime（执行面）

- **职责**：多轮对话、工具调用循环（`runAgent` 等）。  
- **边界**：只依赖 **ChatMessage[]** 与工具 schema 列表。

### 3.5 Tools 与 Skills

- **内置工具注册**：`agent/tools/index.ts`（新增工具在此注册，**builtinProvider** 动态拉 schema）。  
- **Skills**：见 §1.3。

### 3.6 如何新增渠道（步骤摘要）

1. 实现 `ChannelAdapter`。  
2. 在 Gateway 注册。  
3. 单独配置 token 与环境变量。

### 3.7 如何新增 / 使用 Skill（步骤摘要）

1. 在 `skills` 目录放置 JSON。  
2. 合并 ToolSchema；新工具需实现 `Tool`。  
3. `systemPrompt` 拼入上下文。

### 3.8 配置与安全边界

- Gateway：`bindHost`、`PORT`、`webchatToken` 等见 `appConfig`。  
- 工具与脱敏：`doctor` 检查项与 [prd.md](./prd.md)。

### 3.9 规划中的扩展（V2+ 取向）

- 多 Agent、组织级策略等 —— 详见 [specs-archive.md](./specs-archive.md) 各版 PRD 原文块。

---

## 4. 代码入口速查

| 主题 | 路径 |
|------|------|
| 配置 / `appConfig` | `src/config/evn.ts` |
| 统一聊天与任务上下文 | `src/server/chatProcessing.ts` |
| 终端 REPL | `src/cli/repl.ts` |
| TUI（Ink + WS） | `src/tui/`、`src/cli/` 注册 `tui` |
| Agent 循环 | `src/agent/runAgent.ts` |
| Skills 加载 | `src/skills/loadSkills.ts`、`src/agent/withSkills.ts` |
| 任务编排 / 步骤工具闸门 | `src/tasks/taskRunner.ts`、`src/tasks/stepToolPolicy.ts` |
| 任务与审批 | `src/tasks/taskService.ts`、`src/tasks/taskApproval.ts` |
| 工具与 MCP | `src/tools/`、`src/tools/mcpRegistry.ts`、`src/tools/mcpSdkClient.ts` |
| Trace 写入 / 查询 | `src/observability/traceWriter.ts`、`traceQuery.ts`、`traceTypes.ts` |
| Trace CLI | `src/cli/trace.ts` |
| 安全策略 | `src/security/policy.ts`、`pathPolicy.ts`、`execPolicy.ts`、`toolGuard.ts`、`auditSanitize.ts` |
| 策略外置合并 | `src/security/policyOverrides.ts`（若存在） |
| CLI 入口 | `src/cli.ts` |
| CI | `.github/workflows/ci.yml` |
