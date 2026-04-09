# OneClaw 安全配置与风险说明

文档索引见 [README](./README.md)。

## 权限模型（概要）

- **Profile**（如 `webchat_default`、`readonly`、`qq_group`）控制读/写/执行及路径、命令策略。
- **Agent 工具白名单**：限制模型「看到」和执行的内置/部分工具。
- **MCP `allowedToolNames`**：在 Provider 层收缩某个 MCP 服务器暴露的工具名。
三者叠加：任一拒绝即可阻断调用。

## exec
- 可通过 `ONECLAW_EXEC_ENABLED=false` 完全关闭。
- Profile 可配置命令白名单、禁止子串、最大长度等。
- 仅在受控环境开启高权限 profile。

## 文件与 apply_patch
- 写入应限制在用户工作区内；路径白名单/黑名单见 `policy` / `pathPolicy`。
- `apply_patch` 属于高风险工具，受限 profile 下可能被拒绝。

## MCP
- 每个 MCP 子进程继承合并后的环境变量；勿把密钥写进可被他人读取的 `.env` 提交库。
- 务必配置 `allowedToolNames` 或等价约束，避免模型调用意外工具。
- MCP 失败、断连会在下次调用时尝试重连；持续失败会触发 Provider 健康熔断（若已启用）。

## 审计与 Trace
- Trace JSONL 默认含 `traceId`、会话、工具名等；参数经脱敏后写入（见 `auditSanitize`）。
- 日志仍可能包含用户提示片段，请控制 `logs` 目录访问权限。

## 建议
- 生产环境：`WEBCHAT_TOKEN`、`只读或受限 profile`、明确 MCP 白名单、关闭不必要的 exec。