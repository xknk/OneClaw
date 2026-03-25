## OneClaw V2 设计说明（规划）

- 产品名：OneClaw
- 文档类型：V2 规划（V1 见 [prd.md](./prd.md)）
- 产品定位：个人 AI 助手（能做事），本地优先 Gateway 为控制面；V2 侧重程序员开发场景、多 Agent 与自动化。
- 状态：规划中（V2）
- 最近更新：2026-03-19

### 1. 文档目的与范围

本文档在 V1/MVP 已初步完成的前提下，整理：
- **V1 收尾优化建议**：在进入 V2 前建议完成的修复与重构，避免技术债累积。
- **V2 设计方案**：Skills 真正接入、细粒度权限、自动日报与监测、**多 Agent** 等，贴合程序员实际开发需求。

V1 的权威范围与验收仍以 [prd.md](./prd.md) 为准。多 Agent 能力参考 OpenClaw 的「多身份 + 按渠道/场景路由」模式，支持工作/个人分离、专项 Agent（如日报、Code Review）等。

---

### 2. V1 收尾优化建议

以下建议在迭代 V2 前完成，可减少后续改动成本。

#### 2.1 Skills 未真正接入（高优先级）

- **现状**：`withSkills.ts` 中的 `getCombinedToolSchemas()` 与 `loadSkillsFromWorkspace()` 已实现，但未被调用；`runAgent` 仍使用 `getToolSchemas()`，且未注入 Skill 的 `systemPrompt`。
- **影响**：workspace/skills 下的 JSON 技能不会生效。
- **建议**：
  - 在 `/api/chat` 与 `/api/qq/webhook` 的 Agent 调用链中，改为使用 **`getCombinedToolSchemas()`**（需 async/await）。
  - 在构造发给模型的 `messages` 时，将 `loadSkillsFromWorkspace()` 返回的 **`systemPrompts`** 拼成 `role: "system"` 消息插入上下文。
  - 若 Skill 中声明了新工具名，需在运行时提供对应 **Tool 实现** 并纳入 `getTool(name)` 的查找，否则模型会得到「未知工具」。

#### 2.2 会话处理逻辑重复

- **现状**：`createServer.ts` 中 `/api/chat` 与 `/api/qq/webhook` 的「解析入站 → 会话 → 历史 → 压缩 → runAgent → 存回复 → 出站」逻辑几乎相同。
- **建议**：抽成共享函数（如 `handleUnifiedChat(inbound, outboundSender)`），两个路由只做适配器解析与调用，便于维护与新增渠道。

#### 2.3 QQ Webhook 鉴权与日志

- **现状**：Bearer token 校验被注释，且存在 `console.log(req.body)`，存在未鉴权与敏感信息泄露风险。
- **建议**：恢复 token 校验（或通过配置开关），并去掉或降低敏感请求体的日志级别。

#### 2.4 文件与执行权限未细化

- **现状**：仅「必须在 workspace 内」这一层限制，无按会话/渠道的只读、禁止写、禁止 exec 等策略。
- **建议**：V2 设计细粒度权限（见下文）；V1 可在配置层预留字段。

#### 2.5 agentId 已预留但未使用

- **现状**：`session/store`、`session/transcript` 已支持 `agentId` 参数，但调用处未传入。
- **建议**：V2 多 Agent 时在入站/路由中显式传递 `agentId`；V1 保持默认 `main` 即可。

---

### 3. V2 目标与原则

- **目标**：贴合程序员日常开发场景（读代码、改代码、跑命令、查日志、记日报、多项目/多会话），在不动核心协议的前提下扩展工具面、权限面、自动化与**多 Agent**。
- **原则**：保持现有 Gateway + ChannelAdapter + 统一消息模型；新增能力通过配置与扩展点接入，不推翻 V1 架构。多 Agent 采用「多身份 + 路由」模式，与 OpenClaw 对齐。

---

### 4. V2 范围与设计

#### 4.1 Skills 增强

| 方向 | 内容 |
|------|------|
| **真正接入** | 所有 Agent 请求统一使用 `getCombinedToolSchemas()` 并注入 Skill 的 `systemPrompts`（见 2.1）。 |
| **Skill 内 Tool 实现** | 支持在 Skill 中声明「工具名 + 执行类型」：如 `local`（进程内 handler）、`http`（外部 API）、`subagent`（子 Agent）。在 `loadSkillsFromWorkspace` 时将可执行 Skill 工具注册到全局 Tool 查找表。 |
| **按场景启用** | Skill 增加 `enableWhen`（如 sessionKey 前缀、channelId、tags）。Gateway 仅合并满足条件的 Skill，实现「QQ 仅部分技能、WebChat 全量」等。 |
| **程序员常用 Skill 示例** | 如 `git:status/diff/log`、`file:search-in-code`、`run:script`（执行 workspace 内 npm script / Makefile）、`doc:daily-report`（日报生成）。 |

#### 4.2 文件与执行权限（细粒度）

- **权限维度**：与当前请求绑定：`channelId`、`sessionKey`，可选 `userId`/`role`。
- **配置形态**：在 `appConfig` 或独立 policies 中定义 **Profile**（如 `webchat_default`、`qq_group`），每 Profile 指定：`allowReadWorkspace`、`allowWriteWorkspace`（或路径 allowlist/denylist）、`allowExec`、`execAllowlistPatterns` 等。
- **执行前校验**：在 `read_file` / `search_files` / `apply_patch` / `exec` 执行前，由统一 **PolicyChecker** 根据当前请求解析出的 Profile 校验，不通过则直接返回「无权限」。
- **兼容**：默认 Profile 与 V1 行为一致（workspace 内读写 + exec 按现有开关与禁止规则）。

#### 4.3 多 Agent

- **概念**：同一 Gateway 内多个逻辑 Agent，各有独立 systemPrompt、工具子集（通过 Skill 的 `enableWhen` 或 Agent 配置绑定）、独立会话空间（agentId 对应不同 sessions 或 sessionKey 前缀）。参考 OpenClaw：每个 Agent 为独立「大脑」，共享单 Gateway 与端口。
- **路由**：
  - 在 `UnifiedInboundMessage` 中增加可选 `agentId` 或 `intent`。
  - 通过 **bindings** 配置（或触发词如 `/report today`）按 channel、sessionKey、peer 等将请求路由到指定 Agent。
  - `getOrCreateSessionId(sessionKey, agentId)`、`readMessages(..., agentId)` 等一路传递 `agentId`，runAgent 时按 Agent 加载对应 Skills 与 systemPrompt。
- **典型角色**：
  - **主 Agent（main）**：通用对话 + 读代码、改代码、exec（当前行为）。
  - **日报 Agent**：仅根据结构化数据写日报，工具限于读日志、读 Git 摘要、写文件。
  - **Code Review Agent**：仅对指定 diff/文件给出评审，工具仅 read_file、search_files，禁止 apply_patch/exec。
  - **工作 / 个人分离**：按渠道绑定（如 WebChat/QQ 工作群 → work，QQ 私聊 → personal），各自独立 workspace/人设。
- **实现**：增加 **Agent 注册表**（id → config：systemPrompt 前缀、Skill 过滤条件、权限 Profile），Gateway 根据入站解析出 agentId 后执行「会话 → 压缩 → runAgent → 出站」流程。详见 [plugin-boundaries.md](../architecture/plugin-boundaries.md) 的 V2 扩展小节。

#### 4.4 自动监测与日报

- **数据来源**：会话与工具调用（transcript + 可扩展的「工具调用日志」：sessionKey、tool_name、args 脱敏、result 摘要、timestamp）；可选 Git 状态、文件变更摘要、执行记录。
- **日报含义**：由 Agent 或专用「日报 Agent」根据上述数据生成自然语言日报（今日对话主题、执行命令、变更文件、待办建议等）。
- **实现方式**：
  - **定时任务**：每日固定时间（如 18:00）触发流水线：拉取当日会话与工具调用 → 可选 Git/文件摘要 → 调用日报 Agent → 结果写入 workspace（如 `reports/daily-YYYY-MM-DD.md`）或通过渠道发送。
  - **工具**：提供 `generate_daily_report`（参数如 date、sessionKey、outputPath），支持在对话中主动触发「生成昨日/今日日报」。
  - 可同时支持：定时自动写文件 + 对话内按需生成。
- **监测**：定时扫描 workspace/会话/执行记录，满足条件（如「今日无 commit」「某错误关键词」）时触发告警或周报；可做成 Skill + 工具（如 `report:daily`、`report:weekly`、`monitor:no-commit-today`）。

#### 4.5 其他功能性工具建议（程序员向）

- **Git 类**：`git_status`、`git_diff`、`git_log`（只读）；可选 `git_commit`（需权限控制）。
- **运行与脚本**：`run_npm_script`、`run_make_target`，底层复用 `controlledExec`，参数白名单化。
- **代码与文档**：`search_in_code`（正则或简单 AST）、`generate_daily_report`。
- **MCP**：若接入 MCP，可增加 `mcp_call(server, tool, args)` 等工具，在策略允许下调用外部能力。

---

### 5. 落地顺序建议

1. **V1 收尾**：Skills 接入（getCombinedToolSchemas + systemPrompts）+ 会话逻辑抽取 + QQ 鉴权与日志。
2. **权限模型**：设计 Profile 与 PolicyChecker，先按 channel 默认 Profile，再扩展按 session/user。
3. **工具调用日志**：为 runAgent/工具执行层增加「每次调用写一条日志」，供日报与监测使用。
4. **多 Agent**：引入 Agent 注册表与 agentId 传递，先支持 main + daily_report，再扩展 Code Review / 工作-个人分离等。
5. **日报**：先实现「工具 + 单次调用」的 `generate_daily_report`，再增加定时任务与日报 Agent。
6. **Skill 增强**：enableWhen、Skill 内 Tool 实现注册、程序员常用 Skill 包（git、report、run_script）。

---

### 6. 与现有文档的关系

- **[prd.md](./prd.md)**：V1/MVP 范围与验收的权威文档，不做破坏性修改。
- **[plugin-boundaries.md](../architecture/architecture/plugin-boundaries.md)**：扩展渠道、Skill、多 Agent 与权限的边界与步骤，V2 设计与之兼容并已在该文档中补充 V2 扩展说明。

---

### 7. 变更记录

- 2026-03-19：初稿，整理 V1 优化建议与 V2 设计（Skills、权限、多 Agent、日报、工具建议与落地顺序）。