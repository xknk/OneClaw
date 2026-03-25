# 插件化边界与扩展指南

本文档描述 OneClaw 的模块边界、扩展点以及如何新增渠道与技能，便于后续 Phase 2+ 的渠道与 Canvas 接入时不推翻核心设计。

## 1. 模块边界

### 1.1 Gateway（控制面）

- **职责**：HTTP 服务、路由、认证、会话解析、调用 Agent、写回响应。
- **边界**：
  - 不直接解析各渠道的原始协议（如 Discord 的 payload），而是通过 **ChannelAdapter** 得到统一入站消息。
  - 不关心“消息从哪来”，只关心 `UnifiedInboundMessage` → 会话 + Agent → `UnifiedOutboundMessage`。
- **配置**：`appConfig`（env）、PORT、bindHost、workspaceDir、webchatToken 等。

### 1.2 ChannelAdapter（渠道适配层）

- **职责**：把“渠道原始输入”解析为 **UnifiedInboundMessage**；把 **UnifiedOutboundMessage** 写回渠道（如 HTTP 的 res、或 Bot API）。
- **边界**：
  - 入站：`parseInbound(raw) => UnifiedInboundMessage | null`。
  - 出站：`sendOutbound(target, message) => Promise<void>`（target 由具体渠道决定，如 Express `res`）。
- **当前实现**：WebChat（`WebChatChannelAdapter`）、QQ（`QQChannelAdapter`，OneBot v11）。Discord/Telegram 等为预留接口。

### 1.3 统一消息模型（Unified Message）

- **入站**：`UnifiedInboundMessage`（channelId、channelUserId、sessionKey、text、timestamp 等）。
- **出站**：`UnifiedOutboundMessage`（text、metadata 等）。
- **用途**：保证 Gateway 与 Agent 只和“统一消息”打交道，渠道扩展时只需实现 Adapter，不改核心会话与推理逻辑。

### 1.4 Agent Runtime（执行面）

- **职责**：多轮对话、工具调用循环（推理 → tool_calls → 执行 → 再推理）。
- **边界**：只依赖 **ChatMessage[]** 与 **ToolSchema[]** / **Tool[]**，不关心消息来自哪个渠道。
- **工具来源**：内置工具（`agent/tools`）+ 可选 **Skills**（从 workspace/skills 加载的 ToolSchema，以及后续可选的 Tool 实现）。

### 1.5 Tools（能力面）

- **内置工具**：read_file、search_files、apply_patch、exec、get_time、echo 等，在 `agent/tools/index` 中注册。
- **扩展**：通过 **Skills** 在 workspace/skills 目录下提供额外 ToolSchema（及未来可选的执行方式），与内置工具合并后一起交给 Agent。

### 1.6 Skills（能力包）

- **职责**：从 `workspaceDir/skills` 加载 JSON（或后续 .ts）定义的技能包，提供：
  - 额外 **ToolSchema**（与内置合并后给模型看）；
  - 可选 **systemPrompt** 片段（可拼进对话上下文）。
- **边界**：仅“加载与合并”接口；具体是否执行 skill 中声明的工具，取决于是否在运行时注册了对应的 **Tool** 实现（当前可为“仅描述、不执行”或“仅覆盖内置工具描述”）。

---

## 2. 如何新增一个渠道（Channel）

1. **实现 ChannelAdapter**  
   - `channelId`：如 `"discord"`。  
   - `parseInbound(raw)`：从 Discord 的 payload 中取出用户 id、会话标识、文本，构造 `UnifiedInboundMessage`。  
   - `sendOutbound(target, message)`：根据渠道 API 把 `message.text` 发回（如 Discord 发消息 API）。

2. **在 Gateway 中注册**  
   - 在 `createServer` 或统一路由处，根据请求来源（路径、header、等）选择对应 Adapter，用 `parseInbound` 解析；解析成功则走统一会话 + Agent 流程，最后用该 Adapter 的 `sendOutbound` 写回。

3. **配置与安全**  
   - 渠道相关配置（如 Discord token、Telegram bot token）建议通过 env 或 config 读取，并在文档中说明安全与权限边界（DM pairing、allowlist 等见 PRD Phase 2+）。

---

## 3. 如何新增 / 使用 Skill

1. **在 workspace 下创建 skills 目录**  
   - 路径：`appConfig.workspaceDir/skills`（默认如 `~/.oneclaw/workspace/skills`）。

2. **添加 JSON 技能文件**  
   - 单个 Skill：`{ "id": "my-skill", "name": "我的技能", "tools": [ { "name": "...", "description": "...", "parameters": {...} } ], "systemPrompt": "可选系统提示" }`。  
   - 多个 Skill：`{ "skills": [ { "id": "a", ... }, { "id": "b", ... } ] }`。

3. **与 Agent 的衔接**  
   - **ToolSchema**：通过 `loadSkillsFromWorkspace()` 得到 `toolSchemas`，与内置 `getToolSchemas()` 合并（如 `getCombinedToolSchemas()`），再传给 Agent，模型才能“看到”这些工具。  
   - **执行**：若 skill 中的工具名与内置工具一致，可仅覆盖描述；若为全新工具名，需在运行时提供对应 **Tool** 实现并注册到 Agent 使用的工具查找表，否则会返回“未知工具”。

4. **systemPrompt**  
   - `loadSkillsFromWorkspace()` 返回的 `systemPrompts` 可在构造发给模型的 `messages` 时，拼成一条或多条 `system` 消息插入上下文。

---

## 4. 配置与安全边界

- **Gateway**：bindHost、PORT、webchatToken、dataDir、workspaceDir 等由 `appConfig` 统一管理，业务代码不直接读 `process.env`。  
- **渠道**：各 Channel 的 token/密钥等建议单独 key（如 `DISCORD_BOT_TOKEN`），并在文档中说明使用范围与风险。  
- **工具**：exec 开关、workspace 只写、脱敏等见 PRD 与 doctor 检查项。

---

## 5. V2 扩展（规划）

以下扩展点在 V2 中引入，详见 [prd-v2.md](../specs/prd-v2.md)。

- **多 Agent**：入站消息可带 `agentId` 或由 bindings 按 channel/sessionKey 解析出 agentId；Gateway 根据 **Agent 注册表** 选择 Agent，会话与转录按 `agentId` 隔离；每个 Agent 可有独立 systemPrompt、Skill 子集与权限 Profile。
- **权限**：工具执行前按当前请求解析 **Permission Profile**（如按 channelId/sessionKey），经 **PolicyChecker** 校验 `read_file` / `apply_patch` / `exec` 等是否允许；默认 Profile 与 V1 行为一致。
- **Skill**：Skill 可增加 `enableWhen`（如 channelId、sessionKey 前缀、tags），仅合并满足条件的 Skill；Skill 内可声明工具执行类型（local/http/subagent）并注册到全局 Tool 查找表。

---

## 6. 变更与兼容

- 新增渠道或重大扩展时，建议在本文档中补充“新增渠道/技能”的步骤与注意事项，并在 PRD 的变更记录中留档。