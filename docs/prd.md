# OneClaw 产品与交付

**本文档**：产品定位、版本脉络、**交付状态（已完成 / 未完成）**、待办与规划。  
**历史 PRD 与各版全文**：见 [specs-archive.md](./specs-archive.md)（由原 `archive/specs/` 合并）。

**最近对齐代码**：2026-04-10（若实现有变，请同步本节）。

---

## 1. 产品定位

- **名称**：OneClaw  
- **定位**：个人 AI 助手（能对话、能按策略在本机执行任务），**本地优先**的 Gateway 作为控制面。  
- **参考**：能力分层与安全默认等取向可参考 OpenClaw（见 [specs-archive.md](./specs-archive.md) 中 V1 PRD 块）。  
- **非目标（默认）**：不做多租户对抗式共享系统；默认一人一网关的个人助理信任模型。

### 1.1 术语（阅读本文与代码时）

| 术语 | 含义 |
|------|------|
| **Gateway** | 承载 HTTP 与 WebSocket（若启用）、统一会话与工具编排的进程。 |
| **Profile** | 权限策略档位（路径、exec、工具可见性等），可与 `policy-overrides.json` 合并。 |
| **traceId** | 单次请求链路 ID，JSONL 中串联同一轮对话与工具调用；CLI `trace get` / `replay` 使用。 |
| **taskId** | V4 任务主键；带 `taskId` 的聊天会启用任务隔离转录与任务上下文注入。 |
| **PlanStep / allowedTools** | 任务计划中的步骤；`allowedTools` 与 `ToolPolicyGuard`、Runner 共同约束工具调用。 |

---

## 2. 版本脉络（简表）

各版**完整条文、FR 编号与变更记录**均在 [specs-archive.md](./specs-archive.md) 内（按「原文：文件名」分块检索）。

| 版本 | 主题 |
|------|------|
| **V1 / MVP** | WebChat、Gateway、基础工具与 Skills、安全默认 |
| **V2–V3** | 工程化、工具链、Trace、安全加固 |
| **V4** | 任务工作流、多步执行、审批、模板 |
| **V4 剩余项快照** | 与愿景差距（历史对照，以本文 §5.2 为准） |
| **V5** | 平台与生态（多 workspace、插件、策略中心、运维面） |
| **路线图** | V3–V5 节奏建议 |

---

## 3. MVP（V1）核心要求（摘要）

以下内容对应归档 **`prd.md`** 的 MVP 范围；**验收细则与原文**以 [specs-archive.md](./specs-archive.md) 中 **「原文：prd.md」** 块为准。

| 类别 | 要求摘要 |
|------|----------|
| **CLI** | `onboard`、`gateway` 类能力、`doctor`（绑定、鉴权、workspace、模型、危险项等）。 |
| **Gateway** | 默认 `loopback` 绑定；WebChat；统一会话与工具编排；工具调用可观测。 |
| **工具** | workspace 读/搜索/写、`apply_patch`、受控 `exec`；结构化记录、错误码与超时。 |
| **Skills** | 可加载 skills 目录；接口见 [developer.md](./developer.md)。 |
| **安全默认** | WebChat 访问控制（如 token）、写入范围限制、日志脱敏。 |

---

## 4. V4 / V5 摘要

- **V4**：任务状态机、计划 / 执行 / 评审 / 审批闭环、任务时间线、模板与 HTTP/CLI —— 全文见 [specs-archive.md](./specs-archive.md)。**主线能力已在仓库中可验收**；与愿景差距见 **§5.2**。  
- **V5**：多 workspace、插件与策略中心等 —— **规划中**，未作为当前交付承诺。

---

## 5. 交付状态（以代码为准）

### 5.1 已完成（可在仓库中验收）

#### 工程基线（原 V3 / M1–M4）

- **质量与 CI**：单测、`pnpm ci`（typecheck + test + smoke）、GitHub Actions（`.github/workflows/ci.yml`）。  
- **工具链**：`ToolRegistry`、多 Provider、`ToolExecutionService`（守卫、超时、重试、trace）、内置 + Runtime Skill + **MCP（stdio）**；配置见 `ONECLAW_MCP_SERVERS` / `_FILE` 与 `src/config/mcpConfig.ts`。  
- **可观测**：JSONL trace、`pnpm cli trace …`（`get` / `failed` / `slow` / `replay` 等），见 `src/cli/trace.ts`。  
- **安全**：路径 / exec 策略、`toolGuard`、审计脱敏；说明见 [developer.md](./developer.md)。

#### 任务与协作（V4 主线）

- **任务单据**：状态机、时间线、`meta.v4_plan` / `v4_last_review`、报告导出等（`src/tasks/`）。  
- **按步骤工具白名单**：`PlanStep.allowedTools` 与 `ToolPolicyGuard`；Runner 见 `taskRunner.ts`；开关 **`ONECLAW_M2_STEP_TOOL_ENFORCEMENT`**（默认 `true`，见 `appConfig.m2StepToolEnforcement`）。  
- **Checkpoint 与恢复**：失败写检查点、`resume` / `resumeTaskFromCheckpoint`；时间线含 `step_start` / `step_done` / `step_failed` / `resume_from_checkpoint` 等。  
- **高风险审批**：**`ONECLAW_TASK_HIGH_RISK_APPROVAL`**（默认 `true`）；`exec` / `apply_patch` 及 **`riskLevel === "high"`** 的工具可拦截；`approve` 后可将工具名记入 **本任务内** 后续免审集合（`meta` 中的 grants）。  
- **任务上下文聊天**：`taskId` 关联会话与任务上下文注入；工具拒绝可写 `tool_denied`；工具结束可写结构化 timeline 步骤（见 `chatProcessing.ts` / `taskService.ts`）。  
- **Skills 条件启用**：`enableWhen` + `loadSkillsForContext`（见 [developer.md](./developer.md)）。  
- **终端 REPL / TUI**：`pnpm cli repl`、`pnpm cli`（TUI）；说明见 [用户指南](./user-guide.md)。

#### 测试覆盖

- 策略、Runner、恢复相关：单元测试见 `tests/stepToolPolicy.test.ts`、`tests/taskRunner.test.ts` 等。  
- [specs-archive.md](./specs-archive.md) 中 M2 Runner 手册建议的 **固定 E2E 场景**若以独立 E2E 套件衡量，仍建议按需补全（见 §5.2）。

### 5.2 未完成或仅部分满足（相对产品愿景 / 旧 PRD）

下列多为 **体验、规模化或自动化** 层面，核心链路已可用不代表以下已做满。

| 方向 | 说明 |
|------|------|
| **三角色运行时隔离** | 仍有结构化协议与 API；**无**三个独立 Agent 运行时或「Planner 绝不调高风险工具」的硬隔离进程级保证。 |
| **全自动编排服务** | 非「一键从规划 → 多轮执行 → 评审分支」的独立编排服务；当前以 API + Runner + 聊天侧执行为主。 |
| **审批产品化** | 无独立审批队列服务、多任务优先级、审批人角色绑定；策略维度仍以 env + 任务 meta 为主。 |
| **模板与向导** | 模板参数与仓库/分支的 **校验 UI / 向导** 未做。 |
| **Web 任务看板** | API 支持 `failedOnly` 等；**无**独立「仅失败任务」等产品页（若未来扩展 WebChat）。 |
| **长任务恢复「产品级」指标** | 有检查点字段与恢复入口；**无**大规模重放测试与 SLA 类验收。 |
| **V5 平台化** | 多 workspace 治理、插件市场与签名校验、组织级策略中心、运营大盘与告警等 —— 见 [specs-archive.md](./specs-archive.md) 中 V5 章节，状态为 **规划中**。 |

### 5.3 可选增强（不阻塞主线）

- Trace：路径解析统一到单模块；人类可读摘要；HTTP 查询 API；日志轮转策略（当前有按日文件 + 大小轮转 + 保留天数，见 `appConfig`）。  
- MCP：Streamable HTTP / SSE；`RoutingMcpSdkClient` 更重集成测。  
- 运维：部署/备份/日志权限的完整手册；拒绝原因字段与前端命名进一步统一。  
- **终端 REPL 阶段 C**：流式输出、多行编辑、↑ 历史等（规划见 [specs-archive.md](./specs-archive.md) 内工程备忘与对标文档）。

### 5.4 版本节奏（备忘）

- **V3**：工程化底座 — 主线已落地。  
- **V4**：协作与任务流 — **核心已落地**，§5.2 为加深项。  
- **V5**：平台与生态 — **未启动**。

---

## 6. 待办与规划（原独立跟踪合并）

### 6.1 工具失败后的体验

- **现状**：`ToolExecutionService` 在失败时返回错误内容并记录 trace，**对话一般可继续**。  
- **可选增强**：失败时自动转 CLI 等兜底 —— **非必做**。

### 6.2 需产品设计的能力

- **Policy 与多租户**：按用户/租户选择 profile 或外置映射，与 **`{DATA_DIR}/policy-overrides.json`**（按 profileId 合并）的扩展方向。  
- **任务与通知**：`onStepFail` 与审批流、钉钉/邮件/Webhook 等渠道联动。

---

## 7. 相关文档

| 文档 | 用途 |
|------|------|
| [用户指南](./user-guide.md) | 安装、环境变量、TUI/REPL、任务 API、Trace CLI |
| [developer.md](./developer.md) | 架构、安全叠加、Skills、代码入口 |
| [specs-archive.md](./specs-archive.md) | 历史 PRD 与工程长文全文 |

---

## 8. 变更记录

- **2026-04-10**：新增 `docs/prd.md` 作为整合入口；合并原 `apps/server/src/问题.md` 等待办。  
- **2026-04-10**：文档整理 — 交付状态并入本文 §5；原 `进度与规划.md` 删除；历史规格合并为 `specs-archive.md`。  
- **2026-04-10**：用户指南 / 开发者文档细化环境变量与 CLI 行为。
