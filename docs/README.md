# OneClaw 文档

日常阅读**三份主文档**即可；需要查旧版 PRD 原文或 M2 Runner 长文时，再打开第四份。

| 顺序 | 文档 | 读什么 |
|:---:|:---|:---|
| 1 | [**用户指南**](./user-guide.md) | Monorepo 与 `.env` 位置；网关 / TUI / REPL；**环境变量表**（与 `appConfig` 对齐）；目录布局；WebChat 鉴权；**Trace 子命令**（`get` / `failed` / `slow` / `replay`）；任务 API 与 CLI；排障表 |
| 2 | [**产品与交付**](./prd.md) | 术语表；MVP/V4/V5 摘要；**已完成 / 未完成 / 可选增强**；待办 |
| 3 | [**开发与扩展**](./developer.md) | 模块边界；**Profile / Agent / MCP 三层叠加**；`enableWhen` 字段；`policy-overrides.json`；MCP 配置优先级；安全与代码路径 |

| 补充 | 文档 |
|------|------|
| 历史规格全文 | [**specs-archive.md**](./specs-archive.md)（原 `archive/specs/` 合并，按「原文：文件名」分块） |

---

## 归档说明

- [`archive/README.md`](./archive/README.md)：目录说明。  
- 原 `architecture/plugin-boundaries.md` 已并入 [developer.md](./developer.md) §3。
