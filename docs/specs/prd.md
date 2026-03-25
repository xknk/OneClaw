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