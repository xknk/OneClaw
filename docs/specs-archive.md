# OneClaw 历史规格与工程备忘（合并归档）

> 本文档由原 `archive/specs/` 下各文件合并；原分散文件已删除，以本文件为唯一全文归档。交付状态以 [prd.md](./prd.md) 为准。


---

# 原文：roadmap-v3-v5.md

## OneClaw 路线图（V3 -> V5）

- 适用范围：`prd-v3` 之后的中期演进
- 目标：将 OneClaw 从“单机可用的开发助理”升级到“可协作、可扩展、可托管的 Agent 平台”
- 版本策略：每个版本聚焦一个主矛盾，避免同一版本目标过散

---

### 1. 版本分割原则（为什么这样切）

- **V3（已定义）= 工程化底座**  
  先把质量、可观测、权限、工具接入抽象打牢，降低后续升级风险。
- **V4 = 协作与工作流化**  
  在稳态底座上加入任务编排、协作 Agent、人机审批闭环，提升“持续做事”能力。
- **V5 = 平台化与生态化**  
  解决多项目/多用户/多环境托管、插件生态、运营与治理问题，向平台阶段过渡。

---

### 2. 版本总览（按季度节奏）

| 版本 | 周期建议 | 主题 | 核心结果 |
|---|---|---|---|
| V3 | 4-6 周 | 工程化底座 | 可测、可观测、可扩展、可控 |
| V4 | 6-8 周 | 协作与工作流 | 任务可编排、可审批、可回放 |
| V5 | 8-12 周 | 平台与生态 | 多租户治理、插件生态、运维可管 |

> 建议：每个版本只设置 1 个北极星指标 + 3-5 个关键里程碑。

---

### 3. V3 / V4 / V5 关键差异

- **V3 关注“系统正确性”**：不追求花哨能力，先让核心链路稳定和可诊断。
- **V4 关注“持续产出”**：让 Agent 能围绕任务目标多步执行，并且可被人接管与审批。
- **V5 关注“规模化治理”**：让多个项目/团队/环境同时运行，且可控可运营。

---

### 4. 跨版本能力演进图

1. **工具能力**
   - V3：统一 Tool Provider + MCP 基础接入
   - V4：工作流级工具（Git/Issue/CI/部署）组合执行
   - V5：插件市场化分发、版本兼容与签名校验

2. **Agent 能力**
   - V3：多 Agent + 权限与日志
   - V4：Planner/Executor/Reviewer 协作流
   - V5：组织级 Agent 策略编排与资源配额

3. **可观测能力**
   - V3：trace 与回放
   - V4：任务级 KPI（成功率、平均步骤数、人工介入率）
   - V5：全局运营面板与告警治理

4. **安全能力**
   - V3：profile + 路径/参数限制
   - V4：高风险动作审批（human-in-the-loop）
   - V5：租户级策略、合规审计与策略模板

---

### 5. 执行建议（你可以照这个节奏跑）

- **先守住节奏**：每周固定一次版本评审，避免“边做边改方向”。
- **里程碑先验收再并行**：V3 验收达标后再全面推进 V4；V5 只在 V4 稳定后开启。
- **文档与实现双轨同步**：每个里程碑要求“代码 + PRD 更新 + 运行手册更新”。
- **把回归纳入日常**：每个版本末尾预留 20%-30% 时间做修复与性能回归。

---

### 6. 关联文档

- V3 执行版：[`prd-v3.md`](#原文prd-v3md)
- V4 规划：[`prd-v4.md`](#原文prd-v4md)
- V5 规划：[`prd-v5.md`](#原文prd-v5md)



---

# 原文：prd.md

## OneClaw PRD（OpenSpec，MVP：仅 WebChat）

- 产品名：OneClaw
- 参考产品：OpenClaw（能力分层/安全默认/终端优先 onboarding）  
  - Repo: https://github.com/openclaw/openclaw
  - README/VISION/SECURITY 作为对标来源
- 产品定位：个人 AI 助手（能做事），本地优先 Gateway 为控制面
- MVP 渠道：仅 WebChat
- 平台优先级：Windows 优先（可选 WSL2 作为增强路径）
- 状态：定稿（V1/MVP）
- 最近更新：2026-03-03

### 1. 背景与问题
用户需要一个长期在线的个人助理：不仅能对话，还能在本机环境里“执行任务”（读写 workspace 文件、运行受控命令、生成产物），并且默认安全、可审计、可扩展到更多渠道与更强交互面（如 Canvas）。

### 2. 产品目标（Goals）
- **终端优先上手**：提供 `oneclaw onboard`，可靠完成首次配置与启动。
- **本地优先控制面（Gateway）**：统一会话、路由、配置、工具调用编排，并承载 WebChat。
- **可执行能力（MVP 工具面）**：最小闭环工具：受控 exec、workspace 文件读写/搜索、apply_patch。
- **安全默认**：WebChat 默认仅本机访问（loopback），并具备基础认证/访问控制策略（至少 token）。
- **可扩展**：后续增加 Discord/Telegram/Slack/WhatsApp 等渠道、以及 Canvas，不推翻核心，只新增模块。

### 3. 非目标（Non-Goals）
- 不做“多租户对抗式”共享系统；OneClaw 默认是一人一网关（个人助理信任模型）。
- 不在 MVP 做移动端节点、语音唤醒、Canvas、浏览器控制等重能力（列入后续阶段）。

### 4. 范围（Scope）
#### 4.1 MVP（必须交付）
- **CLI**
  - `oneclaw onboard`：创建配置/工作区，配置模型，启动 Gateway（可选安装为后台常驻）。
  - `oneclaw gateway`：启动/停止/查看状态（至少 start/run/status）。
  - `oneclaw doctor`：检测常见风险/缺失配置（最少：bind、auth、workspace、模型配置、危险开关）。
- **Gateway（控制面）**
  - 默认 `bind=loopback`，仅本机访问。
  - 提供 WebChat（浏览器聊天界面）与最小管理页（可合并）。
  - 会话模型：至少 `main` 会话；支持 reset/compact（可选）。
  - 工具调用：支持流式输出（至少文本分块）。
- **工具（MVP）**
  - workspace 文件：read/search（只读）、write/edit/apply_patch（写入默认仅 workspace 内）。
  - 受控 exec：执行命令并返回 stdout/stderr/exitCode；具备超时与策略校验。
  - 统一日志：每次工具调用都记录（结构化）。
- **技能（Skills）**
  - MVP 可以先做“内置技能集合”（硬编码或本地文件），但必须预留“可加载 skills 目录”的接口。
- **安全默认（MVP）**
  - WebChat 必须有访问控制（推荐：token）。
  - apply_patch 默认 workspaceOnly=true。
  - 日志脱敏：至少避免输出常见密钥形态（可后续增强为配置化）。

#### 4.2 Phase 2+（规划，不在 MVP 承诺交付）
- Channels：Discord/Telegram/Slack/WhatsApp/Teams…（引入 DM pairing/allowlist、群组 @mention 激活等安全默认）
- Automation：cron、webhook
- Browser tool
- Canvas（工作台）
- Nodes（移动端/桌面节点）
- Plugins/Skill registry、Memory 插件位、sandbox（non-main/all）

### 5. 关键概念与架构
#### 5.1 模块分层（对标 OpenClaw）
- **Gateway（控制面）**：会话、配置、路由、工具编排、Web surfaces（WebChat/控制页）
- **Agent Runtime（执行面）**：对话与工具调用决策（MVP 可先内嵌在 Gateway 进程）
- **Tools（能力面）**：exec/fs/apply_patch 等
- **Skills（能力包）**：把常见任务封装为可复用入口

#### 5.2 可插拔扩展的硬约束
- 新增渠道 = 新增一个 `ChannelAdapter`（把“外部消息事件”接入到内部统一消息模型）
- 新增 Canvas = 新增一个 “surface + tool family”（例如 `canvas.*`），不改变会话与工具协议核心

### 5.3架构与工程约束（生产级）
- **配置**：环境变量与运行参数通过统一 config 层加载；类型化、带默认值，业务代码不直接依赖 process.env。
- **HTTP**：所有对外 HTTP 请求（含模型 API）经统一封装的 httpClient 发出；支持超时、统一错误类型与日志，便于后续重试/监控/安全审计。
- **模型调用**：通过 ModelProvider 抽象接入（如 Ollama）；请求体与参数由 config/provider 管理，便于扩展多模型与 A/B 测试。


### 6. 功能需求（Functional Requirements）
#### FR-1 WebChat
- 能在浏览器里发送消息给 `main` 会话并收到回复（支持流式更新）。
- 支持基础会话操作：新建/重置（至少重置）。
- 支持上传/展示：MVP 可仅文本；媒体后续做。

#### FR-2 工具调用（MVP）
- read/search：读取 workspace 内文件、按关键字搜索（只读）。
- write/edit/apply_patch：在 workspace 内写入/修改文件（默认禁止 workspace 外路径）。
- exec：受控命令执行（默认限制命令/参数模式，具备超时）。
- 工具调用必须：
  - 记录输入（脱敏）与输出
  - 有明确错误码/错误消息
  - 可配置超时/最大输出大小

#### FR-3 配置与 Onboarding
- `oneclaw onboard` 至少完成：
  - 创建配置文件
  - 初始化 workspace
  - 配置模型提供方（先支持 1 个也可以，但要预留多提供方结构）
  - 启动 Gateway 并能通过 WebChat 对话
- `oneclaw doctor` 至少检查：
  - Gateway 是否 loopback 绑定
  - 是否启用认证（token）
  - workspace 路径是否可用
  - apply_patch 是否 workspaceOnly
  - 模型配置是否可用

#### FR-4 日志与可观测性（MVP）
- 结构化日志：run/session/tool-call 级别事件
- 可在本地查看最近 N 条日志（CLI 或简单页面）

### 7. 安全与信任模型（MVP 版）
- OneClaw 的默认模型是“个人助理”：同一 Gateway 的已认证调用者视为同一操作者信任边界（与 OpenClaw 的 Operator Trust Model 一致的取向）。
- Web surfaces 默认不对公网暴露：`bind=loopback`；远程访问走 SSH/Tailnet（后续文档化）。
- 工具与文件系统写入采取最小化默认：workspaceOnly。

### 8. MVP 验收标准（Acceptance Criteria）
- 在一台 Windows 机器上：
  - `oneclaw onboard` 完成后，Gateway 可常驻运行（或能稳定启动）。
  - 打开 WebChat，能与 `main` 会话对话，回复支持流式输出或分块更新。
  - 完成一个端到端任务：读取文件 → 生成补丁 → apply_patch 写回 workspace → WebChat 返回结果摘要。
  - `oneclaw doctor` 能识别并提示至少 5 类风险/缺失配置（见 FR-3）。

### 9. 后续扩展策略（写在 PRD 里，作为架构保证）
- 每新增一个渠道/模块，必须新增一份独立规格文档（见模板），并在本 PRD 的“范围/里程碑/验收”中做增量更新（保留变更记录）。

### 10. 变更记录
- 2026-03-03：确定 MVP 仅 WebChat；渠道与 Canvas 进入 Phase 2+ 规划。

---

# 原文：prd-v2.md

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
- **实现**：增加 **Agent 注册表**（id → config：systemPrompt 前缀、Skill 过滤条件、权限 Profile），Gateway 根据入站解析出 agentId 后执行「会话 → 压缩 → runAgent → 出站」流程。详见 [developer.md](./developer.md) 的 V2 扩展小节。

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
- **[developer.md](./developer.md)**：扩展渠道、Skill、多 Agent 与权限的边界与步骤，V2 设计与之兼容并已在该文档中补充 V2 扩展说明。

---

### 7. 变更记录

- 2026-03-19：初稿，整理 V1 优化建议与 V2 设计（Skills、权限、多 Agent、日报、工具建议与落地顺序）。

---

# 原文：prd-v3.md

## OneClaw PRD V3（执行版）

- 产品名：OneClaw
- 文档类型：V3 执行版（V1 见 [prd.md](./prd.md)，V2 见 [prd-v2.md](#原文prd-v2md)）
- 产品定位：本地优先、可执行、可审计的个人开发助理
- 对标对象：OpenClaw（多 Agent、工具生态、安全默认、可观测）
- 状态：执行中（V3）
- 最近更新：2026-03-24

### 1. V3 背景与目标

V1 解决了最小闭环（WebChat + 工具调用），V2 完成了多 Agent/Skills/权限/日报的基础接入。  
V3 的核心目标是：把“能跑”升级为“可持续迭代、可上线使用、可快速扩展”。

V3 目标分为三条主线：

- **工程可靠性**：建立测试与回归基线，降低后续改动风险。
- **能力生态化**：让新增工具能力以配置/插件方式接入，而不是频繁改核心代码。
- **运行可观测性**：把对话与工具执行变成可追踪、可回放、可诊断的系统。

### 2. 当前状态评估（基于代码现状）

#### 2.1 已完成能力（可作为 V3 起点）

- 统一消息处理链路已成型：渠道适配 -> 会话 -> 上下文管理 -> Agent -> 回传。
- 多 Agent 路由已具备：`agents.json` + bindings + `resolveAgentId`。
- Skills 基础链路已打通：按上下文加载、system prompt 注入、runtime tool 注册。
- 权限拦截已存在：profile + tool 级校验（read/write/exec）。
- 日志与日报已有基础：tool-call 记录与日报生成能力已具雏形。

#### 2.2 主要短板（V3 重点补齐）

- 缺少系统化测试（单测/集成/回归），发布风险较高。
- 工具生态接入仍偏“内置实现”，外部能力接入成本高。
- 可观测性不够产品化：有日志文件，但缺可检索视图和失败诊断闭环。
- 权限策略仍偏静态规则，参数级与路径级精细控制不足。

### 3. V3 范围（In Scope / Out of Scope）

#### 3.1 In Scope（V3 必须交付）

1. **质量底座**
   - 建立最小测试体系（agent 核心循环、权限策略、skills 过滤、路由决策）。
   - 引入基础 CI 检查（至少：类型检查 + 测试 + 启动烟测）。
2. **工具生态化**
   - 统一 Tool Provider 接口，支持内置 + skill + 外部协议（优先 MCP 适配）。
   - 新增工具可通过配置注册，不改 Agent 主流程。
3. **可观测与回放**
   - 为每次对话生成 `traceId` 全链路事件。
   - 提供最近会话/工具调用查询与失败回放入口（CLI 或 API）。
4. **安全增强（不破坏现有行为）**
   - 在现有 profile 基础上增加路径与参数级限制能力。
   - 对高风险工具（exec/apply_patch）增加更清晰拒绝原因和审计字段。

#### 3.2 Out of Scope（V3 不承诺）

- Canvas 图形工作台。
- 多节点部署与集群编排。
- 移动端 App 与语音交互。
- 完整插件市场（仅做协议与加载机制，不做市场分发）。

### 4. 关键需求（Functional Requirements）

#### FR-1 测试与质量门禁

- 为 `runAgent` 增加关键行为测试：
  - 无 toolCalls 时直接返回。
  - 未知工具与工具异常可被模型感知。
  - 超过最大轮次时安全退出。
- 为权限策略增加测试：
  - 只读 profile 禁止写与执行。
  - exec 命令 allowlist 生效。
- 为 skills 加载增加测试：
  - `enableWhen` 按 channel/session/agent/keyword 过滤正确。
  - 同名工具 schema 合并覆盖行为符合预期。

#### FR-2 工具生态化接入

- 统一定义 Tool Provider 抽象：
  - `name`、`schema`、`execute`、`source`、`riskLevel`。
- 支持三类来源：
  - 内置工具（existing）。
  - skill 本地/HTTP 工具（existing + 规范化）。
  - 外部工具协议（优先 MCP adapter）。
- 在 Agent 执行时仍保持统一入口：`getTool(name)` 与 `getToolSchemas()`。

#### FR-3 可观测与回放

- 记录以下结构化事件：
  - 会话开始/结束、模型请求、模型响应、工具调用开始/结束、权限拒绝。
- 每条事件最少包含：
  - `traceId`、`sessionKey`、`agentId`、`timestamp`、`eventType`、`durationMs`（可选）、`ok`（可选）。
- 提供查询能力：
  - 按 `traceId` 查看一次完整执行链路。
  - 按时间/agent/tool 查看失败与慢调用。

#### FR-4 安全增强

- 在 profile 维度支持：
  - 文件路径 allowlist/denylist。
  - exec 参数/子命令规则限制。
- 对拒绝场景输出清晰可解释结果（可直接反馈给模型和用户）。
- 审计日志默认脱敏（保留定位信息，不泄露敏感参数）。

### 5. 非功能要求（NFR）

- **稳定性**：核心接口在单机开发场景下可持续运行 24h，无明显内存泄漏。
- **可维护性**：新增工具能力的改动文件数控制在可预期范围（尽量不触碰核心循环）。
- **可诊断性**：任一失败请求可在 5 分钟内通过 trace 定位到失败阶段。
- **兼容性**：V3 升级不破坏既有 WebChat/QQ 基本流程与配置习惯。

### 6. 里程碑与验收（Milestones）

#### M1（第 1 周）：质量基线

- 交付：
  - 核心单测覆盖（agent/policy/skills/router）。
  - CI 最小门禁接入。
- 验收标准：
  - 新增测试可稳定通过。
  - 核心路径变更可被测试拦截回归。

#### M2（第 2 周）：工具生态化

- 交付：
  - Tool Provider 抽象层。
  - skill/local/http 工具统一到 provider 注册机制。
  - 外部协议适配骨架（MCP adapter stub 或首版可用实现）。
- 验收标准：
  - 新增一个工具无需改 `runAgent`。
  - 工具 schema 与 runtime execute 保持一致。

#### M3（第 3 周）：可观测与回放

- 交付：
  - trace 事件模型与日志落盘规范。
  - trace 查询与会话回放入口（CLI/API 至少一种）。
- 验收标准：
  - 给定 `traceId` 能完整复盘一次请求。
  - 能快速定位 top 失败工具与 top 慢调用。

#### M4（第 4 周）：安全增强与收尾

- 交付：
  - 路径/参数级策略增强。
  - 拒绝信息与审计字段标准化。
  - 文档补齐（使用手册 + 风险说明）。
- 验收标准：
  - 高风险操作在受限 profile 下可稳定拒绝。
  - 既有场景无明显功能回退。

### 7. 风险与应对

- **风险 1：测试改造带来短期开发速度下降**
  - 应对：先覆盖最关键链路，避免一次性全量补齐。
- **风险 2：工具抽象改造影响现有调用**
  - 应对：保留旧接口适配层，分阶段迁移。
- **风险 3：日志过量影响性能与存储**
  - 应对：事件分级、可配置采样、日志轮转。
- **风险 4：安全规则过严影响可用性**
  - 应对：提供 profile 分层与明确错误提示，支持灰度调整。

### 8. 成功指标（Success Metrics）

- 发布后 2 周内：
  - 核心链路回归缺陷数显著下降（以测试拦截为主）。
  - 新增工具能力的平均接入时间下降。
  - 失败请求可定位率提升（trace 可复盘比例接近全量）。
  - 高风险工具误放行事件为 0。

### 9. 与前序文档关系

- `prd.md`：定义 V1/MVP 的底线范围与验收。
- `prd-v2.md`：定义 V2 的能力方向与架构增强。
- `prd-v3.md`：聚焦“执行与落地”，把 V2 能力转化为可持续工程体系。

### 10. 变更记录

- 2026-03-24：创建 V3 执行版，明确四阶段里程碑（质量、生态、可观测、安全）与可验收标准。


---

# 原文：prd-v4.md

## OneClaw PRD V4（协作与工作流版）

- 产品名：OneClaw
- 文档类型：V4 规划与执行版（承接 [prd-v3.md](#原文prd-v3md)）
- 主题：从“可用 Agent”升级为“可持续交付的任务系统”
- 状态：规划中（V4）
- 最近更新：2026-03-24

### 1. V4 目标

V4 的核心是让 OneClaw 从单轮问答/工具调用，升级为可执行完整任务闭环：

- 任务拆解（Plan）
- 多步执行（Execute）
- 自动校验（Review）
- 人工审批（Approve）
- 结果沉淀（Report）

一句话：**让 Agent 能稳定“做完一件事”，而不仅是“回答一段话”。**

### 2. 范围（In Scope / Out of Scope）

#### 2.1 In Scope（V4 必做）

1. **任务工作流引擎（Task Workflow）**
   - 引入任务状态机：`draft -> planned -> running -> review -> approved/rejected -> done`。
   - 支持中断恢复（失败后从最近检查点继续）。
2. **多 Agent 协作模式**
   - 定义 Planner / Executor / Reviewer 三角色。
   - 支持角色切换与上下文隔离。
3. **人机审批闭环**
   - 高风险操作（写文件、exec、外部发布）进入审批队列。
   - 支持“批准一次”“本任务批准”“长期批准策略”。
4. **任务级可观测性**
   - 从 trace 升级到 task timeline，记录每个步骤输入/输出/耗时/结果。
5. **开发场景模板化**
   - 提供标准任务模板：修 bug、代码评审、日报生成、发布准备。

#### 2.2 Out of Scope（V4 不承诺）

- 多租户商业化计费。
- 公网插件市场。
- 跨组织权限治理。

### 3. 关键需求（FR）

#### FR-1 任务状态机

- 每个任务必须有唯一 `taskId`。
- 任务可查询当前状态、历史状态迁移、失败原因。
- 任务支持取消、重试、从指定检查点恢复。

#### FR-2 协作 Agent

- Planner 仅负责拆解任务，不直接执行高风险工具。
- Executor 负责按计划执行工具步骤。
- Reviewer 负责质量与风险检查，必要时打回执行。
- 三者之间通过结构化中间结果交互，而非自由文本约定。

#### FR-3 审批系统

- 高风险步骤进入 `pending_approval` 状态。
- 审批信息最少包含：动作摘要、影响范围、回滚建议。
- 审批结果可回写到任务 timeline。

#### FR-4 任务模板库

- 提供最小模板集合：
  - `fix_bug`
  - `code_review`
  - `daily_report`
  - `release_precheck`
- 模板可配置参数（项目路径、目标分支、风险级别）。

#### FR-5 任务视图（CLI/API）

- 可列出最近任务、查看单任务详情、查看失败任务。
- 可导出任务执行报告（Markdown/JSON）。

### 4. 非功能要求（NFR）

- **可靠性**：长任务执行中断后恢复成功率可观（进程重启后仍可恢复）。
- **可解释性**：任一任务失败可定位到具体步骤与工具调用。
- **可控性**：高风险动作必须可被拦截与审批。
- **兼容性**：保持 V3 API 兼容，新增能力尽量以增量接口提供。

### 5. 里程碑与验收

#### M1（第 1-2 周）：任务引擎基础

- 交付：task model、状态机、任务存储、任务查询 API。
- 验收：可创建任务并完成状态流转，失败可回溯。

#### M2（第 3-4 周）：三角色协作

- 交付：Planner/Executor/Reviewer 协议与最小实现。
- 验收：至少 2 个模板任务可完整执行并被 reviewer 判定。

#### M3（第 5-6 周）：审批与风控

- 交付：审批队列、审批命令/API、策略开关。
- 验收：高风险步骤未经审批不可继续；审批日志完整。

#### M4（第 7-8 周）：模板与体验收尾

- 交付：4 个标准模板、任务报告导出、文档完善。
- 验收：模板任务可重复跑通，失败场景可定位可恢复。

### 6. 成功指标

- 任务完成率提升（相对 V3 的“单轮执行完成率”）。
- 人工接管次数下降（同类型任务）。
- 高风险误执行事件为 0。
- 任务平均定位时间（MTTR）下降。

### 7. 风险与应对

- **任务模型过重导致开发复杂度上升**  
  应对：先做最小状态机，模板先少量高价值场景。
- **协作 Agent 提示词耦合高**  
  应对：强化结构化中间协议，减少纯 prompt 依赖。
- **审批流程影响效率**  
  应对：引入分级审批和策略缓存（短期授权）。

### 8. 变更记录

- 2026-03-24：创建 V4 文档，定义任务工作流、协作 Agent、审批闭环与模板化目标。



---

# 原文：prd-v4-remaining.md

# OneClaw PRD V4 — 未完成项汇总

> **维护说明**：差距与完成度请以 [prd.md](./prd.md) 为准；本文为 2026-04-01 对照快照，未再逐条同步代码。

- **对应主文档**：[prd-v4.md](#原文prd-v4md)
- **用途**：记录当前实现与 V4 目标之间的差距，便于排期与验收对齐。
- **最近更新**：2026-04-01

---

## 1. 总体结论

V4 **M1（任务引擎）**、**M4（模板 + 报告导出 + 文档）** 主线已可交付；**M2 / M3** 以「数据结构 + API + 最小闸门」为主，PRD 中若干 **自动化编排、策略分级、全量风控** 尚未实现。  
下列条目即为 **尚未完成或与 PRD 表述存在明显差距** 的部分（不含 V4 已声明的 Out of Scope）。

---

## 2. 按 PRD 功能需求（FR）

### FR-2 协作 Agent（Planner / Executor / Reviewer）

| 未完成点 | 说明 |
|---------|------|
| 三角色 **运行时隔离** | 已有结构化协议（`v4_plan`、`v4_last_review`）与 API；**无**三个独立 Agent 循环或强制「Planner 绝不调用高风险工具」的执行约束。 |
| **Executor** 按计划逐步 enforced 执行 | 仍为通用 `runAgent` + 工具；**未**按 `PlanStep` 自动锁定步骤、顺序与允许工具集合（仅文档/提示层）。 |
| **验收级端到端** | PRD 所写「至少 2 个模板任务 **完整执行** 并由 reviewer **判定**」——能力具备，**无**一键自动化演示或固定 E2E 脚本固化。 |

### FR-3 审批系统

| 未完成点 | 说明 |
|---------|------|
| **「批准一次」之上的策略** | PRD：**本任务长期批准**、**长期批准策略 / 短期授权**；当前仅 **单次拦截 → `approve` → 用户/模型重试工具**。 |
| **审批队列（产品化）** | 现为任务状态 `pending_approval` + `meta` 快照；**无**独立队列服务、多任务优先级、审批人角色绑定。 |
| **高风险覆盖面** | 已覆盖 **`exec`、`apply_patch`**（且需带 `taskId`）；PRD 中的 **其它写文件路径、外部发布** 等 **未**统一按风险等级扩展（如 MCP 工具、`riskLevel === high` 自动纳入）。 |
| **审批结果写回** | `approve` 会写 timeline、`v4_last_approval`；若 PRD 要求 **更细粒度审批日志**（操作者、策略命中原因），仍可增强。 |

### FR-4 任务模板（深化）

| 未完成点 | 说明 |
|---------|------|
| 模板 **仅** 默认标题/plan 骨架/params | 模板参数与真实仓库/分支的 **校验、向导 UI** 未做。 |

### FR-5 任务视图（补充）

| 未完成点 | 说明 |
|---------|------|
| **专用「仅失败任务」产品入口** | API 支持 `failedOnly`；Web 端 **无**独立任务列表页（若未来将 WebChat 外延到任务看板）。 |

### 任务级可观测（与 2.1 / NFR 交叉）

| 未完成点 | 说明 |
|---------|------|
| **Timeline 逐步自动写入「输入/输出/耗时/结果」** | `timeline` 支持 `kind: "step"`，但 **未**在每次工具调用结束 **自动**追加结构化步骤（与 trace 对齐）。 |
| **失败定位到具体工具调用** | `failureReason`、`checkpoint` 有；**未**系统化工单字段关联 `traceId` / 工具尝试序号，便于从任务跳转 trace。 |

---

## 3. 按里程碑（M2 / M3）

### M2 三角色协作 — 未饱和部分

- 缺少 **编排层**：自动「规划 → 执行多轮 → 送审 → 根据 verdict 分支」的一条龙服务（可工作流引擎或状态机驱动 Runner）。
- **角色切换**：无独立「Reviewer 专用」模型调用链配置（仅 API + 自建 agentId 约定）。

### M3 审批与风控 — 未饱和部分

- **策略开关**：仅有 `ONECLAW_TASK_HIGH_RISK_APPROVAL`；**无**按任务/模板/工具维度的分级策略表。
- **未经审批不可继续**：对 **已列出** 的高风险工具在「带 `taskId` + 开关开启」下成立；其它泄漏面见上 **高风险覆盖面**。

---

## 4. 非功能要求（NFR）差距

| 项 | 说明 |
|----|------|
| **长任务恢复成功率** | 有磁盘任务单与检查点字段；**无**从 checkpoint 自动 resume 的 Runner 产品与成体系的重放测试。 |
| **可解释性** | 任务层与时间线可人工读；**自动**关联「第 N 步 ↔ 哪次 tool 调用」未完成。 |

---

## 5. 建议后续优先级（非承诺排期）

1. **工具执行钩子写 `timeline` step**（绑定 `traceId`、耗时、ok）— 直接抬高 FR「步骤级可观测」与 NFR 可解释性。  
2. **高风险工具集扩展**：`ToolDefinition.riskLevel === "high"` 或配置表，与 `taskApproval` 统一。  
3. **审批策略**：`meta` 或 env 支持「本任务后续同类工具免审直至 `running` 结束」等最小策略。  
4. **可选**：模板任务 E2E 脚本或集成测试，满足 M2 验收表述。

---

## 6. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-04-01 | 首版：基于当前代码与 [prd-v4.md](#原文prd-v4md) 对比整理的未完成项清单。 |


---

# 原文：prd-v5.md

## OneClaw PRD V5（平台与生态版）

- 产品名：OneClaw
- 文档类型：V5 规划与执行版（承接 [prd-v4.md](#原文prd-v4md)）
- 主题：从“个人任务系统”升级为“可治理的平台能力”
- 状态：规划中（V5）
- 最近更新：2026-03-24

### 1. V5 目标

V5 的核心是平台化：支持多项目、多环境、多身份协作，并保持安全与可运营。

一句话：**让 OneClaw 可以被“长期托管”和“规模化使用”。**

### 2. 范围（In Scope / Out of Scope）

#### 2.1 In Scope（V5 必做）

1. **工作空间与环境治理**
   - 多 workspace 管理（项目级隔离）。
   - 环境配置分层（global/project/user）。
2. **插件生态体系**
   - 插件清单、版本管理、兼容矩阵。
   - 插件签名与安全校验（最小可用）。
3. **组织级权限与策略**
   - 角色模板（owner/developer/reviewer/readonly）。
   - 策略中心（工具、路径、命令、审批策略）。
4. **运营与可观测平台**
   - 全局 dashboard（任务成功率、失败类型、慢任务、资源占用）。
   - 告警机制（失败率激增、风险动作异常、执行超时）。
5. **发布与生命周期管理**
   - 版本升级向导、迁移脚本、回滚机制。
   - 稳定版/实验版能力开关（feature flag）。

#### 2.2 Out of Scope（V5 不承诺）

- 商业收费系统。
- 完整 SaaS 公有云托管（可先保留私有部署能力）。
- 全渠道 UI 大重构。

### 3. 关键需求（FR）

#### FR-1 多 workspace 管理

- 支持注册/切换/禁用 workspace。
- 每个 workspace 具备独立：
  - agent 配置
  - skills 与插件
  - 权限策略
  - 日志与任务数据

#### FR-2 插件平台

- 插件元数据规范：
  - `id`、`version`、`compatibility`、`permissions`、`entry`。
- 插件安装流程：
  - 校验 -> 安装 -> 激活 -> 健康检查 -> 回滚能力。
- 插件运行限制：
  - 默认最小权限，超权请求需审批或拒绝。

#### FR-3 策略中心

- 可集中定义并下发策略：
  - 工具白名单/黑名单
  - 路径访问策略
  - 命令策略
  - 审批规则
- 支持策略版本化与变更审计。

#### FR-4 全局运维面板

- 至少提供：
  - 任务总览（成功/失败/平均耗时）
  - 风险动作统计
  - 资源占用趋势（CPU/内存/队列）
  - 插件健康状态
- 支持按 workspace / agent / 时间窗口筛选。

#### FR-5 发布治理

- 提供版本迁移检测与自动备份。
- 升级失败可回滚到上一版本数据与配置。
- feature flag 支持按 workspace 分批启用。

### 4. 非功能要求（NFR）

- **可扩展性**：插件数增加后核心性能可接受，不出现明显退化。
- **可治理性**：策略变更全链路可审计。
- **稳定性**：升级/回滚流程可重复、可自动化。
- **安全性**：插件和高风险工具默认零信任。

### 5. 里程碑与验收

#### M1（第 1-3 周）：多 workspace 与策略中心基础

- 交付：workspace registry、策略中心最小模型、策略下发链路。
- 验收：可对不同 workspace 生效不同策略。

#### M2（第 4-6 周）：插件生命周期管理

- 交付：插件安装/激活/停用/卸载 + 兼容校验。
- 验收：插件异常可隔离，不影响核心服务可用性。

#### M3（第 7-9 周）：运营面板与告警

- 交付：全局指标聚合、告警规则引擎、基础仪表盘。
- 验收：能发现并告警高失败率和高风险异常行为。

#### M4（第 10-12 周）：发布与回滚治理

- 交付：迁移脚本、备份回滚、feature flag 控制台（CLI/API）。
- 验收：升级失败可快速回滚，关键数据不丢失。

### 6. 成功指标

- 多 workspace 场景下稳定运行（长时间不干预）。
- 插件接入周期明显缩短（相较 V4 手工接入）。
- 平台级故障定位时间下降，回滚成功率提升。
- 策略违规与误放行持续下降。

### 7. 风险与应对

- **平台化过早导致复杂度飙升**  
  应对：先做最小治理闭环，不追求大而全。
- **插件生态带来安全面扩大**  
  应对：签名校验 + 最小权限 + 审批机制 + 隔离执行。
- **多 workspace 带来运维负担**  
  应对：标准模板、自动化检查、健康诊断工具增强。

### 8. 变更记录

- 2026-03-24：创建 V5 文档，定义平台化目标（治理、生态、运维、发布）。



---

# 原文：implementation-progress-m1-m3.md

# OneClaw 实施进度备忘（M1–M4）

> **维护说明**：日常请以根目录 [prd.md](./prd.md) 为交付状态入口；本文件为历史工程快照，保留作细节索引。

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
- **用户文档**：`docs/user-guide.md`（含 MCP env 示例）、`docs/developer.md`（安全章节）。

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
| 使用与风险 | `docs/user-guide.md`、`docs/developer.md`（安全章节） |

---

## 7. 变更记录

- **2026-03-28**：初稿（M1–M3）。
- **2026-04-01**：同步 M2 MCP（stdio + env 配置）、M3 CLI/单测现状、M4 安全与文档、文件索引与待办刷新。


---

# 原文：m2-production-runner-executor.md

# OneClaw M2 生产级实施手册（Runner / Executor / Checkpoint 自动恢复）

**目标**：交付可用于生产的 M2，而不是演示版。  
**范围**：按 `PlanStep` 编排执行、严格工具白名单约束、从 checkpoint 自动恢复。  
**原则**：流程尽量简单，策略双层兜底，关键决策全可观测。

---

## 1）最小架构（建议保持）

- **Runner**：按 `PlanStep` 驱动任务生命周期（`pending -> running -> done|failed`）。
- **Executor**：仅执行当前步骤允许的模型/工具动作。
- **Policy Guard（共享）**：基于当前步骤 `allowedTools` 校验工具调用。
- **Checkpoint Manager**：失败时持久化 `stepIndex` 与恢复载荷；从最近有效 checkpoint 恢复。

不要把所有逻辑塞进一个文件；各角色应可单测、可独立演进。

---

## 2）生产规则（必须满足）

1. **双层强校验**  
   - Runner 在执行前预检查。  
   - Executor 在调用工具前硬检查。  
   （任一层被绕过，另一层仍可阻断风险调用。）

2. **确定性状态流转**  
   - 同一时刻最多一个步骤为 `running`。  
   - 步骤状态更新需与任务 `updatedAt` 原子一致。

3. **恢复幂等**  
   - 对同一 checkpoint 重试恢复，不得重复产生副作用。  
   - 使用 checkpoint token/hash 或步骤级幂等键。

4. **失败即关闭（Fail Closed）**  
   - 未知工具 / 缺少 `allowedTools` / 步骤结构不合法 => 一律拒绝执行。  
   - 禁止静默降级为“全允许”。

5. **结构化可观测**  
   - 每次步骤开始/结束/失败都写 timeline，并带可关联字段（`traceId`、`stepIndex`、`toolName`）。

---

## 3）一次性改完的完整规划（生产级）

本节按“**模块 -> 改动点 -> 完成标准**”给出一口气落地方案，你可以连续开发，不必按 A/B/C 切换上下文。

### 3.1 模块一：策略内核（Policy Core）

**改动点**
- 新增一个纯函数（建议名：`assertToolAllowedForStep`）。
- 输入：`planStep`、`toolName`、可选 `normalizer`。
- 输出：通过；或抛 `ToolPolicyError`（含 `code`）。
- 规则：
  - `planStep` 缺失或结构异常：拒绝。
  - `allowedTools` 缺失/空：拒绝（fail closed）。
  - 工具名做标准化匹配（建议小写 + trim）。
  - 未命中 allowlist：拒绝并附 `NOT_IN_ALLOWLIST`。

**完成标准**
- 不依赖 IO、配置、全局状态（纯函数）。
- 错误码稳定：`STEP_INVALID`、`TOOL_INVALID`、`NOT_IN_ALLOWLIST`。
- 可直接复用于 Runner 和 Executor 两侧。

### 3.2 模块二：Runner 编排主循环（Orchestrator）

**改动点**
- 增加“按 `PlanStep` 连续执行”的 Runner 入口（可由任务服务或独立编排服务调用）。
- 执行顺序：
  1. 读取任务与计划（`v4_plan`）。
  2. 选出下一可执行步骤（`pending` 或可恢复步骤）。
  3. 将该步骤置为 `running`，写 timeline：`step_start`。
  4. 调 Executor 执行当前步骤。
  5. 成功则置 `done` 并写 `step_done`；失败则置 `failed` 并写 checkpoint，任务置 `failed`。
- 强约束：
  - 同一时刻只能一个 `running`。
  - 步骤状态与任务 `updatedAt` 同次持久化（避免并发脏写）。

**完成标准**
- 连续跑完整个计划直到终态（`done`/`failed`）。
- 任一步失败都能精确停在该步并记录失败上下文。

### 3.3 模块三：Executor 硬闸门（Hard Gate）

**改动点**
- 在 Executor 的每次工具调用前强制调用 `assertToolAllowedForStep`。
- 被拒绝时：
  - 直接抛类型化策略错误；
  - 不触发 provider、不做降级重试；
  - 写 timeline：`tool_denied`，包含 `toolName`、`stepIndex`、`code`。
- 将策略拒绝统一映射为可追踪失败原因（`failureReason` 含 reason code）。

**完成标准**
- “策略拒绝”不会再向下游 provider 渗透。
- 日志/trace 可区分“工具本身失败”和“策略拒绝”。

### 3.4 模块四：Checkpoint 与自动恢复（Auto Resume）

**改动点**
- 失败时写 `v4_checkpoint`：
  - `stepIndex`、`at`、`traceId`、`idempotencyKey`、可选 `payload`。
- 重试/恢复入口统一：
  - 读取最新 checkpoint；
  - 校验 taskId 与 plan 版本；
  - 从 `checkpoint.stepIndex`（或策略定义的安全起点）继续；
  - 写 timeline：`resume_from_checkpoint`。
- 幂等控制：
  - 同一 checkpoint 重复恢复，不重复执行已完成步骤；
  - 可用 `idempotencyKey` 做去重保护。

**完成标准**
- 自动恢复稳定，且不会把已完成步骤重跑。
- checkpoint 无效或过期时明确报错，不自动猜测。

### 3.5 模块五：可观测与错误模型（Observability）

**改动点**
- 统一 timeline 事件：`step_start`、`step_done`、`step_failed`、`tool_denied`、`resume_from_checkpoint`。
- 统一错误结构：`{ code, message, stepIndex?, toolName?, traceId? }`。
- 所有关键事件带可关联字段：`traceId`、`taskId`、`stepIndex`、`toolName`。

**完成标准**
- 通过任务视图就能回答：哪一步、哪个工具、为何失败/拒绝、从哪恢复。

---

## 4）建议改动清单（一次提交可完成）

- `src/tasks` 下新增/调整：
  - 策略模块（例如 `stepToolPolicy.ts`）
  - Runner 编排模块（例如 `taskRunner.ts`）
  - Checkpoint 恢复模块（如需拆分）
- `src/tools` / 执行链：
  - Executor 前置硬闸门接入
  - 拒绝场景错误映射
- `src/server` / 路由：
  - 如有 `resume`/`retry` 入口，统一走自动恢复逻辑
- `src/tasks/taskService.ts`：
  - 暴露编排入口与恢复入口（或调用编排服务）

> 备注：文件名可按你现有结构调整，但职责边界建议保持。

---

## 5）测试方案（一次补齐）

1. **策略单测（必须）**
   - allow 命中通过
   - deny 返回 `NOT_IN_ALLOWLIST`
   - step 无效返回 `STEP_INVALID`
   - 空 allowlist fail-closed

2. **Runner 单测（必须）**
   - 单步/多步顺序推进正确
   - 同时仅一个 `running`
   - 失败写 checkpoint 且 task -> `failed`

3. **恢复单测（必须）**
   - 从 checkpoint 正确续跑
   - 已完成步骤不重跑
   - 无效 checkpoint 被拒绝

4. **E2E（建议至少 2 条）**
   - `fix_bug`：工具被策略拒绝 -> 恢复 -> 完成
   - `code_review`：只读步骤严格限制工具

---

## 6）发布与回滚

- 先保留一个总开关：`ONECLAW_M2_STEP_TOOL_ENFORCEMENT=true|false`。
- 上线策略：
  - 初始小流量（或模板白名单）验证拒绝率与误杀率；
  - 稳定后全量开启。
- 回滚策略：
  - 仅关闭 enforcement，不回滚数据结构（meta 字段保持前向兼容）。

---

## 7）完成定义（DoD）

- 当前步骤外的工具调用全部被阻断（双层检查生效）。
- 任一步失败都可生成可恢复 checkpoint。
- `retry/resume` 能自动续跑且具备幂等保证。
- timeline/trace 可完整解释执行路径与拒绝原因。
- 自动化测试覆盖策略、编排、恢复、关键 E2E 场景。



---

# 原文：skills-conditional-case.md

# OneClaw 条件启用 Skills 案例

本文是一个可直接复用的案例：实现「仅在满足条件时注入并使用 Skills」。

适用场景：
- 只有在某些关键词出现时才启用某个 Skill（例如日报）
- 只有特定渠道（`webchat` / `qq`）才启用某些 Skill
- 只有特定会话（`sessionKey` 前缀）才启用某些 Skill

---

## 1. 目标

把当前“全量注入所有 skills”的逻辑改成“按请求上下文过滤后再注入”，实现硬约束。

当前流程（已实现）：
- `loadSkillsFromWorkspace()`：加载全部 skills
- `getCombinedToolSchemas()`：合并全部内置/skills tools
- `handleUnifiedChat()`：注入全部 `systemPrompts`

目标流程：
- `loadSkillsForContext(ctx)`：加载并过滤 skills
- `getCombinedToolSchemasForContext(ctx)`：只合并命中的 skills tools
- `handleUnifiedChat()`：只注入命中的 `systemPrompts`

---

## 2. 需要改的文件

- `src/skills/types.ts`
- `src/skills/loadSkills.ts`
- `src/agent/withSkills.ts`
- `src/server/chatProcessing.ts`
- （可选）`workspace/skills/*.json`：增加 `enableWhen`

---

## 3. 代码修改示例

## 3.1 `src/skills/types.ts`

在 `Skill` 中加入条件字段：

```ts
import type { ToolSchema } from "@/llm/providers/ModelProvider";

export interface SkillEnableWhen {
    channelIds?: string[];
    sessionKeyPrefixes?: string[];
    keywordsAny?: string[];
}

export interface Skill {
    id: string;
    name?: string;
    description?: string;
    tools?: ToolSchema[];
    systemPrompt?: string;
    config?: Record<string, any>;

    // 新增：条件启用规则（全部可选）
    enableWhen?: SkillEnableWhen;
}

export interface LoadedSkills {
    skills: Skill[];
    toolSchemas: ToolSchema[];
    systemPrompts: string[];
}
```

---

## 3.2 `src/skills/loadSkills.ts`

新增“按上下文加载”的能力（保留 `loadSkillsFromWorkspace`，避免破坏现有调用）。

```ts
import type { LoadedSkills, Skill } from "./types";
import type { ToolSchema } from "@/llm/providers/ModelProvider";

export interface SkillRuntimeContext {
    channelId: string;
    sessionKey: string;
    userText: string;
}

function matchEnableWhen(skill: Skill, ctx: SkillRuntimeContext): boolean {
    const rule = skill.enableWhen;
    if (!rule) return true; // 未配置规则则默认启用

    if (rule.channelIds?.length) {
        if (!rule.channelIds.includes(ctx.channelId)) return false;
    }

    if (rule.sessionKeyPrefixes?.length) {
        const ok = rule.sessionKeyPrefixes.some((p) => ctx.sessionKey.startsWith(p));
        if (!ok) return false;
    }

    if (rule.keywordsAny?.length) {
        const text = ctx.userText.toLowerCase();
        const ok = rule.keywordsAny.some((k) => text.includes(k.toLowerCase()));
        if (!ok) return false;
    }

    return true;
}

export async function loadSkillsForContext(ctx: SkillRuntimeContext): Promise<LoadedSkills> {
    const all = await loadSkillsFromWorkspace();
    const matchedSkills = all.skills.filter((s) => matchEnableWhen(s, ctx));

    const toolSchemas: ToolSchema[] = [];
    const systemPrompts: string[] = [];
    for (const skill of matchedSkills) {
        if (skill.tools?.length) {
            for (const t of skill.tools) {
                if (t?.name) toolSchemas.push(t);
            }
        }
        if (skill.systemPrompt?.trim()) {
            systemPrompts.push(skill.systemPrompt.trim());
        }
    }

    return { skills: matchedSkills, toolSchemas, systemPrompts };
}
```

---

## 3.3 `src/agent/withSkills.ts`

新增按上下文合并工具 schemas 的函数：

```ts
import { getToolSchemas } from "./tools/index";
import type { ToolSchema } from "@/llm/providers/ModelProvider";
import {
    loadSkillsForContext,
    type SkillRuntimeContext,
} from "@/skills/loadSkills";

export async function getCombinedToolSchemasForContext(
    ctx: SkillRuntimeContext
): Promise<ToolSchema[]> {
    const base = getToolSchemas();
    const { toolSchemas: skillTools } = await loadSkillsForContext(ctx);

    const map = new Map<string, ToolSchema>();
    for (const t of base) map.set(t.name, t);
    for (const t of skillTools) map.set(t.name, t);
    return [...map.values()];
}
```

---

## 3.4 `src/server/chatProcessing.ts`

把“全量加载”改成“按上下文加载”：

```ts
import {
    loadSkillsForContext,
    type SkillRuntimeContext,
} from "@/skills/loadSkills";
import { getCombinedToolSchemasForContext } from "@/agent/withSkills";

// ... inside handleUnifiedChat
const runtimeCtx: SkillRuntimeContext = {
    channelId: inbound.channelId,
    sessionKey,
    userText,
};

const { systemPrompts } = await loadSkillsForContext(runtimeCtx);
if (systemPrompts.length > 0) {
    messages = [{ role: "system", content: systemPrompts.join("\n\n") }, ...messages];
}

const toolSchemas = await getCombinedToolSchemasForContext(runtimeCtx);
const replyText = await runAgent(messages, getAllTools(), { toolSchemas });
```

---

## 4. Skill JSON 示例

文件：`workspace/skills/report-only.json`

```json
{
  "id": "report:daily-only",
  "name": "日报技能（条件启用）",
  "enableWhen": {
    "channelIds": ["webchat"],
    "sessionKeyPrefixes": ["main", "work:"],
    "keywordsAny": ["日报", "总结", "daily report"]
  },
  "systemPrompt": "仅在用户明确要求日报/总结时生效。输出结构：今日完成、问题、明日计划。"
}
```

文件：`workspace/skills/exec-guard.json`

```json
{
  "id": "exec:guard",
  "name": "命令执行守卫",
  "enableWhen": {
    "channelIds": ["webchat", "qq"]
  },
  "systemPrompt": "当前为 Windows 环境。仅当用户明确要求执行命令时才调用 exec；优先使用 dir/type 等 Windows 命令。"
}
```

---

## 5. 验证步骤

1. 重启服务。
2. 输入：`帮我生成今日日报`  
   - 预期：命中 `report-only.json`，回复结构为日报模板。
3. 输入：`你好`  
   - 预期：不命中日报关键词，不启用日报 skill。
4. 若要观察调试信息，可在 `loadSkillsForContext` 里临时输出 `matchedSkills.map(s => s.id)`。

---

## 6. 注意事项

- 仅改 `systemPrompt` 属于软约束，模型可能偶发偏离。
- 本案例核心价值在于“注入前过滤”，属于硬约束。
- 若你后续要做企业级权限控制，建议再加执行层 PolicyChecker（工具执行前二次校验）。

---

## 7. 回滚方案

若要快速回退到旧逻辑：
- `chatProcessing.ts` 恢复调用 `loadSkillsFromWorkspace()` 与 `getCombinedToolSchemas()`
- 保留新字段 `enableWhen` 不会影响旧逻辑（旧逻辑会忽略它）

