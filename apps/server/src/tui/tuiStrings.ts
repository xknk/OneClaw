import path from "node:path";
import type { UiLocale } from "@/config/evn";
import { appConfig, ollamaConfig, zhipuConfig } from "@/config/evn";
import { getAgentRegistryPath } from "@/agent/loadAgentRegistry";
import { resolveMcpServersFilePathForAdmin } from "@/config/mcpConfig";
import { getConfigDir, getTaskTemplatesFilePath } from "@/config/runtimePaths";
import { getFileAccessDeniedPrefixes, getFileAccessRoots } from "@/config/fileAccessPolicy";

export function slashMenuBar(locale: UiLocale): string {
    return locale === "en"
        ? "Slash commands · ↑↓ select · Tab fill · Enter run"
        : "斜杠命令 · ↑↓ 选择 · Tab 填入 · Enter 执行";
}

/** /model 子菜单（与 SlashMenu 控件一致） */
export function modelMenuBar(locale: UiLocale): string {
    return locale === "en"
        ? "Models · ↑↓ select · Tab fill id · Enter to switch"
        : "模型列表 · ↑↓ 选择 · Tab 填入 id · Enter 切换";
}

export function slashMenuMore(locale: UiLocale, n: number): string {
    return locale === "en" ? `… ${n} more not shown` : `… 另有 ${n} 条未显示`;
}

export function tuiHelpLines(
    locale: UiLocale,
    opts: { sessionKey: string; taskId?: string },
): string {
    if (locale === "en") {
        const lines = [
            "Built-in commands:",
            "  /help, /?         This help",
            "  /session <key>    Switch session key (transcript when not using --task)",
            "  /model <id>       Switch chat model (type `/model ` then ↑↓ Tab)",
            "  /clear            Clear messages in this window",
            "  /status           Session, model, and paths summary",
            "  /workspace        Config files: MCP, templates, skills, agents",
            "  /onboard          Run onboarding",
            "  /doctor           System self-check",
            "  /task ...         Task CLI (same as pnpm cli task ...)",
        "  /trace ...        Trace CLI (same as pnpm cli trace ...)",
        "  /approve-risk     optional if the approval menu is missing (session risk)",
        "  /task-approve     optional if the approval menu is missing (--task pending)",
        "  /exit, /quit      Exit TUI",
            "",
            "Type `/` at line start for the menu; ↑↓ select, Tab fill, Enter run.",
            "",
            "Tip: each new terminal run gets a unique session unless you pass --session.",
            "If pnpm dev is running, avoid using the same sessionKey as a Web tab on purpose.",
        ];
        if (opts.taskId) {
            lines.push(
                "",
                `Current: --task ${opts.taskId} is set; transcript key task:${opts.taskId} (alongside sessionKey=${opts.sessionKey}).`,
            );
        }
        return lines.join("\n");
    }
    const lines = [
        "内置命令:",
        "  /help, /?         本帮助",
        "  /session <key>    切换会话键（仅影响未带 --task 时的转录）",
        "  /model <id>       切换对话模型（输入 `/model ` 后用 ↑↓ / Tab）",
        "  /clear            清空本窗口消息列表",
        "  /status           会话、模型与目录摘要",
        "  /workspace        配置文件路径（MCP、模板、技能、agents）",
        "  /onboard          运行初始化",
        "  /doctor           运行系统自检",
        "  /task ...         执行任务命令（同 pnpm cli task ...）",
        "  /trace ...        执行 trace 命令（同 pnpm cli trace ...）",
        "  /approve-risk     无菜单时的备用：会话级高危放行（优先用下方 ↑↓ 菜单）",
        "  /task-approve     无菜单时的备用：--task 且任务待审批时批准",
        "  /exit, /quit      退出 TUI",
        "",
        "行首输入 `/` 弹出命令列表；↑↓ 选择，Tab 填入，Enter 补全或执行。",
        "",
        "提示: 每次新开终端默认新会话；续聊请启动时传 --session。勿与 Web 故意共用同一 sessionKey。",
    ];
    if (opts.taskId) {
        lines.push(
            "",
            `当前: 已关联 --task ${opts.taskId}，转录键 task:${opts.taskId}（与 sessionKey=${opts.sessionKey} 并存）。`,
        );
    }
    return lines.join("\n");
}

export function tuiStatusLines(
    locale: UiLocale,
    opts: { sessionKey: string; agentId?: string; taskId?: string },
): string {
    const na = locale === "en" ? "(not set)" : "(未指定)";
    if (locale === "en") {
        return [
            "TUI status:",
            `  sessionKey: ${opts.sessionKey}`,
            `  agentId: ${opts.agentId ?? na}`,
            `  taskId: ${opts.taskId ?? na}`,
            "",
            "Ollama Config:",
            `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
            `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
            `  skillsDir → ${appConfig.skillsDir}`,
            `  Ollama → ${ollamaConfig.baseUrl} · model ${ollamaConfig.modelName}`,
            "",
            "ZhiPu Config:",
            `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
            `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
            `  skillsDir → ${appConfig.skillsDir}`,
            `  ZhiPu → ${zhipuConfig.baseUrl} · model ${zhipuConfig.modelName}`,
        ].join("\n");
    }
    return [
        "TUI 状态:",
        `  sessionKey: ${opts.sessionKey}`,
        `  agentId: ${opts.agentId ?? "(未指定)"}`,
        `  taskId: ${opts.taskId ?? "(未指定)"}`,
        "",
        "Ollama配置摘要:",
        `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
        `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
        `  skillsDir → ${appConfig.skillsDir}`,
        `  Ollama → ${ollamaConfig.baseUrl} · model ${ollamaConfig.modelName}`,
        "",
        "ZhiPu配置摘要:",
        `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
        `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
        `  skillsDir → ${appConfig.skillsDir}`,
        `  ZhiPu → ${zhipuConfig.baseUrl} · model ${zhipuConfig.modelName}`,
    ].join("\n");
}

/**
 * TUI：与 Web「工作区」页面对应的磁盘路径，便于用户直接编辑 JSON。
 */
export function tuiWorkspaceLines(locale: UiLocale): string {
    const mcp = resolveMcpServersFilePathForAdmin();
    const tpl = getTaskTemplatesFilePath();
    const agents = getAgentRegistryPath();
    const skills = path.join(appConfig.skillsDir, "skills");
    if (locale === "en") {
        return [
            "Workspace files (JSON). Edit here or use Web → Workspace when the gateway runs:",
            `  dataDir          → ${path.resolve(appConfig.dataDir)}`,
            `  config dir       → ${path.resolve(getConfigDir())}`,
            `  MCP servers      → ${path.resolve(mcp)}`,
            `  task templates   → ${path.resolve(tpl)}`,
            `  skills (*.json)  → ${path.resolve(skills)}`,
            `  agents registry  → ${path.resolve(agents)}`,
            `  user workspace   → ${path.resolve(appConfig.userWorkspaceDir)}`,
            `  file access roots → ${getFileAccessRoots().map((r) => path.resolve(r)).join(" | ")}`,
            ...(getFileAccessDeniedPrefixes().length
                ? [
                      `  file access deny → ${getFileAccessDeniedPrefixes().map((r) => path.resolve(r)).join(" | ")}`,
                  ]
                : []),
            "",
            "Set ONECLAW_SKILLS_DIR / ONECLAW_DATA_DIR in .env to change roots; ONECLAW_FILE_ACCESS_EXTRA_ROOTS for more roots.",
        ].join("\n");
    }
    return [
        "工作区配置文件（可在此用编辑器改 JSON，或启动网关后在 Web「工作区」里改）：",
        `  数据目录         → ${path.resolve(appConfig.dataDir)}`,
        `  配置目录         → ${path.resolve(getConfigDir())}`,
        `  MCP 列表         → ${path.resolve(mcp)}`,
        `  任务模板         → ${path.resolve(tpl)}`,
        `  技能目录         → ${path.resolve(skills)}`,
        `  Agent 注册表     → ${path.resolve(agents)}`,
        `  用户工作目录     → ${path.resolve(appConfig.userWorkspaceDir)}`,
        `  文件可访问根     → ${getFileAccessRoots().map((r) => path.resolve(r)).join(" | ")}`,
        ...(getFileAccessDeniedPrefixes().length
            ? [
                  `  文件拒绝前缀     → ${getFileAccessDeniedPrefixes().map((r) => path.resolve(r)).join(" | ")}`,
              ]
            : []),
        "",
        "可通过 .env 中 ONECLAW_SKILLS_DIR、ONECLAW_DATA_DIR 调整路径；ONECLAW_FILE_ACCESS_EXTRA_ROOTS 增加可访问目录。",
    ].join("\n");
}

export function tuiWelcomeSubtitle(locale: UiLocale): string {
    return locale === "en" ? "Welcome back · local TUI" : "欢迎 · 本地 TUI";
}

export function tuiTipsSlash(locale: UiLocale): string {
    return locale === "en" ? "Tips: type / for commands" : "提示：输入 / 查看命令";
}

export function tuiSessionLabel(locale: UiLocale): string {
    return locale === "en" ? "session" : "会话";
}

/** 高风险拦截后（若需在聊天区追加说明）：TUI 以菜单为准 */
export function tuiRiskSessionHint(locale: UiLocale): string {
    return locale === "en"
        ? "High-risk tool blocked: use the menu below (↑↓ Enter). Do not type approve in the input box."
        : "高风险已拦截：请用下方菜单 ↑↓ 选择后 Enter；勿在输入框手打「同意」。无菜单时再用 /approve-risk 或输入「同意」。";
}

export function tuiRiskTaskHint(locale: UiLocale, taskId: string): string {
    return locale === "en"
        ? `Task ${taskId} pending approval: use the menu (↑↓ Enter), same idea as Web.`
        : `任务 ${taskId} 待审批：请用下方菜单 ↑↓ Enter 选择；勿手打「同意」。`;
}

/** 底栏：有待审批的高风险操作（与「空闲」互斥展示） */
export function metaRiskAwaiting(locale: UiLocale): string {
    return locale === "en" ? "approval pending" : "待审批";
}

/** 高风险 / 任务审批：Claude Code 式列表菜单标题 */
export function riskMenuTitle(locale: UiLocale, kind: "session" | "task"): string {
    if (locale === "en") {
        return kind === "task"
            ? "This task step needs your approval"
            : "High-risk action needs your approval";
    }
    return kind === "task" ? "任务步骤需要确认" : "高风险操作需要确认";
}

/** 菜单底部操作说明（与模型列表区风格一致） */
export function riskMenuFooter(locale: UiLocale): string {
    return locale === "en"
        ? "↑↓ select · Enter confirm · Esc reject · no typing in the box"
        : "↑↓ 选择同意/拒绝 · Enter 确认 · Esc 拒绝 · 无需在输入框输入";
}

export type RiskMenuEntry = { label: string; submitText: string };

/** 与 parseRiskApprovalIntent 对齐的提交句（菜单 Enter 直接发送） */
export function riskMenuEntries(locale: UiLocale): [RiskMenuEntry, RiskMenuEntry] {
    if (locale === "en") {
        return [
            { label: "1. Yes, approve", submitText: "approve" },
            { label: "2. No, reject", submitText: "reject" },
        ];
    }
    return [
        { label: "1. 同意并继续", submitText: "同意" },
        { label: "2. 拒绝", submitText: "拒绝" },
    ];
}

/** REPL 在 /help 中追加的说明（与 TUI 帮助略有不同） */
export function replHelpAppend(locale: UiLocale): string {
    if (locale === "en") {
        return [
            "",
            "REPL: type `/` then Tab to complete; `/` + Enter lists commands.",
            "",
            "CLI (pnpm cli repl …):",
            "  --session <key>    Resume a session; omit = new cli-<uuid> each run",
            "  --agent <id>       Agent ID",
            "  --task <taskId>    Bind task (transcript key task:<id>)",
            "  -v, --verbose      Print traceId / metadata to stderr",
        ].join("\n");
    }
    return [
        "",
        "REPL：行首 `/` 后按 Tab 可补全；单独输入 `/` 回车可列出命令。",
        "",
        "启动参数（pnpm cli repl …）:",
        "  --session <key>    续聊指定会话；省略则每次启动新建 cli-<uuid>",
        "  --agent <id>       Agent ID",
        "  --task <taskId>    关联任务（转录固定为 task:<id>）",
        "  -v, --verbose      stderr 打印 traceId / metadata",
    ].join("\n");
}

export function replStatusLines(
    locale: UiLocale,
    opts: { sessionKey: string; agentId?: string; taskId?: string; verbose: boolean },
): string {
    const na = locale === "en" ? "(not set)" : "(未指定)";
    const head =
        locale === "en"
            ? [
                  "REPL status:",
                  `  sessionKey: ${opts.sessionKey}`,
                  `  agentId: ${opts.agentId ?? na}`,
                  `  taskId: ${opts.taskId ?? na}`,
                  `  verbose: ${opts.verbose}`,
                  "",
                  "Config:",
                  `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
                  `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
                  `  skillsDir → ${appConfig.skillsDir}`,
                  `  Ollama → ${ollamaConfig.baseUrl} · model ${ollamaConfig.modelName}`,
                  "",
                  "ZhiPu配置摘要:",
                  `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
                  `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
                  `  skillsDir → ${appConfig.skillsDir}`,
                  `  ZhiPu → ${zhipuConfig.baseUrl} · model ${zhipuConfig.modelName}`,
                ]
            : [
                  "REPL 状态:",
                  `  sessionKey: ${opts.sessionKey}`,
                  `  agentId: ${opts.agentId ?? "(未指定)"}`,
                  `  taskId: ${opts.taskId ?? "(未指定)"}`,
                  `  verbose: ${opts.verbose}`,
                  "",
                  "Ollama配置摘要:",
                  `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
                  `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
                  `  skillsDir → ${appConfig.skillsDir}`,
                  `  Ollama → ${ollamaConfig.baseUrl} · model ${ollamaConfig.modelName}`,
                  "",
                  "ZhiPu配置摘要:",
                  `  ONECLAW_DATA_DIR → ${appConfig.dataDir}`,
                  `  userWorkspaceDir → ${appConfig.userWorkspaceDir}`,
                  `  skillsDir → ${appConfig.skillsDir}`,
                  `  ZhiPu → ${zhipuConfig.baseUrl} · model ${zhipuConfig.modelName}`,
                ];
    if (opts.verbose) {
        head.push(locale === "en" ? "verbose: on." : "当前: verbose=开。");
    }
    return head.join("\n");
}

export function replUnknown(locale: UiLocale): string {
    return locale === "en"
        ? "Unknown command. Type /help or `/` + Tab."
        : "未知命令。输入 /help 或 `/` + Tab。";
}

export function replSessionUsage(locale: UiLocale): string {
    return locale === "en" ? "Usage: /session <key>" : "用法: /session <key>";
}

export function replSessionSwitchedMsg(locale: UiLocale, key: string, taskId?: string): string {
    const lines = [locale === "en" ? `sessionKey set to ${key}` : `已切换 sessionKey=${key}`];
    if (taskId) {
        lines.push(
            locale === "en"
                ? "(Note: --task is active; transcript key remains task:<taskId>.)"
                : "（提示：当前仍带 --task，实际转录键仍为 task:<taskId>。）",
        );
    }
    return lines.join("\n");
}

export function replBannerLine(locale: UiLocale, opts: { sessionKey: string; agentId?: string; taskId?: string }): string {
    let s =
        locale === "en"
            ? `OneClaw REPL · sessionKey=${opts.sessionKey}`
            : `OneClaw REPL · sessionKey=${opts.sessionKey}`;
    if (opts.agentId) s += locale === "en" ? ` · agentId=${opts.agentId}` : ` · agentId=${opts.agentId}`;
    if (opts.taskId) s += ` · taskId=${opts.taskId}`;
    return s;
}

export function replPromptLine(locale: UiLocale): string {
    return locale === "en"
        ? "Enter to send; /help for help; `/` + Tab completes; /exit to quit.\n"
        : "输入消息回车发给模型；/help 帮助；行首 `/` + Tab 补全；/exit 退出。\n";
}

export function replSigint(locale: UiLocale): string {
    return locale === "en" ? "\n[repl] exited (SIGINT)" : "\n[repl] 已退出（SIGINT）";
}

export function tuiEmptyHint(locale: UiLocale): string {
    return locale === "en"
        ? "Type a message, Enter to send. Same chain as REPL / WebChat."
        : "在此输入消息，Enter 发送。对话链与 REPL / WebChat 相同。";
}

/** 第二行「输入 / 打开命令…」拆成前后，中间渲染橙色 `/` */
export function tuiSlashOpenLine(locale: UiLocale): { before: string; after: string } {
    return locale === "en"
        ? { before: "Type ", after: " to open the command menu (↑↓ Tab Enter)." }
        : { before: "输入 ", after: " 打开命令菜单（↑↓ Tab Enter）。" };
}

export function tuiGenerating(locale: UiLocale): string {
    return locale === "en" ? "generating response…" : "正在生成回复…";
}

/** 模型轮次开始前（与 Claude Code 「thinking」类似） */
export function tuiMetaLlmRound(locale: UiLocale, round: number | undefined): string {
    const r =
        round != null && typeof round === "number" && Number.isFinite(round) && round > 0
            ? String(Math.floor(round))
            : "?";
    return locale === "en" ? `Thinking… (round ${r})` : `思考中…（第 ${r} 轮）`;
}

/** 工具开始执行时的轻量提示行 */
export function tuiToolRunningLine(locale: UiLocale, toolName: string, argsPreview: string): string {
    const ap = argsPreview.trim();
    if (locale === "en") {
        return ap.length ? `Running ${toolName} — ${ap}` : `Running ${toolName}…`;
    }
    return ap.length ? `正在执行「${toolName}」— ${ap}` : `正在执行「${toolName}」…`;
}

/** 工具卡片左侧标题（按工具名粗分类，贴近 Bash command / Reading file 分区） */
export function tuiToolCardSectionTitle(locale: UiLocale, toolName: string): string {
    const n = toolName.trim().toLowerCase();
    if (n === "exec" || n.includes("bash") || n.includes("shell") || n.includes("terminal")) {
        return locale === "en" ? "Shell command" : "Shell 命令";
    }
    if (n.includes("read")) {
        return locale === "en" ? "Read" : "读取";
    }
    if (n.includes("write") || n.includes("patch") || n.includes("apply")) {
        return locale === "en" ? "Write / patch" : "写入 / 补丁";
    }
    return locale === "en" ? `Tool · ${toolName}` : `工具 · ${toolName}`;
}

export function tuiToolCardArgsLabel(locale: UiLocale): string {
    return locale === "en" ? "Arguments" : "参数";
}

export function tuiToolCardOutputLabel(locale: UiLocale): string {
    return locale === "en" ? "Output" : "输出";
}

/** 底栏：贴近 Claude Code 的快捷键提示（本机 TUI 实际为 Ctrl+G/Ctrl+C） */
export function tuiFooterActionHints(locale: UiLocale): string {
    return locale === "en" ? "Ctrl+G stop · Ctrl+C exit" : "Ctrl+G 停止 · Ctrl+C 退出";
}

/** WebSocket「工具执行完毕」一行（与 assistant 风格区分：用 system，便于扫日志） */
export function tuiToolFinishedLine(
    locale: UiLocale,
    toolName: string,
    ok: boolean,
    durationMs: number,
): string {
    const ms = Math.max(0, Math.round(durationMs));
    return locale === "en"
        ? `Tool ${toolName} — ${ok ? "ok" : "failed"} (${ms}ms)`
        : `工具「${toolName}」${ok ? "完成" : "失败"}（${ms}ms）`;
}

export function tuiInputFooter(locale: UiLocale): string {
    return locale === "en"
        ? "Enter send · / commands · inverted block is cursor"
        : "Enter 发送 · / 命令 · 反色块为光标";
}

export function tuiPlaceholder(locale: UiLocale): string {
    return locale === "en" ? "Type message…" : "输入消息…";
}

export function tuiBottomHint(locale: UiLocale): string {
    return locale === "en"
        ? " ? shortcuts · / command list · /help · Ctrl+C exit"
        : " ? 快捷键 · / 命令列表 · /help · Ctrl+C 退出";
}

/** 生成中状态栏：停止流式（与 Web「停止」对应） */
export function metaStopGen(locale: UiLocale): string {
    return locale === "en" ? "Ctrl+G stop gen" : "Ctrl+G 停止生成";
}


export function errNotConnected(locale: UiLocale): string {
    return locale === "en" ? "Not connected; cannot send." : "未连接，无法发送";
}

/** 上一条仍在生成时拒绝再发一条（避免客户端 pending 与服务端串行队列错位导致永久「流式」） */
export function tuiBusyBlockSend(locale: UiLocale): string {
    return locale === "en"
        ? "A reply is still generating. Wait for it, or press Ctrl+G to stop, then send again."
        : "上一条回复仍在生成。请等待结束，或按 Ctrl+G 停止后再发送。";
}

export function errDoneNoContent(locale: UiLocale): string {
    return locale === "en"
        ? "Request finished but the model returned nothing to show. Retry or simplify."
        : "本次请求已结束，但模型没有返回可显示内容。请重试或简化问题。";
}

export function errAborted(locale: UiLocale): string {
    return locale === "en"
        ? "Request timed out or aborted. Retry or shorten the prompt."
        : "请求超时或被中断（This operation was aborted）。请重试，或缩短问题后再试。";
}

export function errPrefix(locale: UiLocale): string {
    return locale === "en" ? "Error: " : "错误: ";
}

/** 底栏状态条：就绪 / 流式 / 空闲 等 */
export function metaReady(locale: UiLocale): string {
    return locale === "en" ? "ready" : "就绪";
}

export function metaStreaming(locale: UiLocale): string {
    return locale === "en" ? "streaming" : "流式";
}

export function metaIdle(locale: UiLocale): string {
    return locale === "en" ? "idle" : "空闲";
}

export function metaCtrlC(locale: UiLocale): string {
    return locale === "en" ? "Ctrl+C exit" : "Ctrl+C 退出";
}

/** WebSocket 状态文案（与内部 state 一致） */
export function wsStatusLabel(locale: UiLocale, s: string): string {
    if (locale === "en") return s;
    const map: Record<string, string> = {
        "connecting...": "连接中…",
        "connecting…": "连接中…",
        connected: "已连接",
        disconnected: "已断开",
        error: "错误",
    };
    return map[s] ?? s;
}

export function usageSession(locale: UiLocale): string {
    return locale === "en" ? "Usage: /session <key>" : "用法: /session <key>";
}

export function usageModel(locale: UiLocale): string {
    return locale === "en"
        ? "Usage: /model <id> — type `/model ` then pick with ↑↓ and Tab, or: /model zhipu"
        : "用法: /model <id> — 可先输入 `/model ` 用 ↑↓ 与 Tab 选择，或直接: /model zhipu";
}

export function modelSwitched(locale: UiLocale, modelId: string, label: string): string {
    return locale === "en"
        ? `Chat model set to「${modelId}」(${label}). Next messages use this model.`
        : `已切换对话模型为「${modelId}」（${label}）。之后发消息将使用此模型。`;
}

export function modelUnknown(locale: UiLocale, id: string): string {
    return locale === "en"
        ? `Unknown model id "${id}". Type /status, or type /model plus Space to open the picker.`
        : `未知模型 id「${id}」。请用 /status，或输入「/model 」（含空格）打开列表。`;
}

export function modelsNotLoaded(locale: UiLocale): string {
    return locale === "en"
        ? "Model list not ready yet (wait for connection)."
        : "模型列表尚未就绪（请等待连接建立）。";
}

export function sessionSwitched(locale: UiLocale, rest: string, taskId?: string): string {
    if (locale === "en") {
        return taskId
            ? `sessionKey set to ${rest}\n(Note: --task is active; transcript key remains task:<taskId>.)`
            : `sessionKey set to ${rest}`;
    }
    return taskId
        ? `已切换 sessionKey=${rest}\n（提示：当前仍带 --task，实际转录键仍为 task:<taskId>。）`
        : `已切换 sessionKey=${rest}`;
}

export function unknownCommand(locale: UiLocale): string {
    return locale === "en"
        ? "Unknown command. Type /help or `/` for the list."
        : "未知命令。输入 /help 或 `/` 查看列表。";
}

export function needsArgSession(locale: UiLocale): string {
    return locale === "en"
        ? "Usage: /session <key> (type a space then the key, or send /session mykey)"
        : "用法: /session <key>（输入空格后继续键名，或直接发送 /session mykey）";
}

export function needsArgGeneric(locale: UiLocale): string {
    return locale === "en" ? "This command needs arguments." : "该命令需要参数。";
}
