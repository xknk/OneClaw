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

