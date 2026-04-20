/**
 * OneClaw CLI 入口文件
 */

import "dotenv/config"; // 1. 优先加载 .env 环境变量，确保后续 appConfig 能读到配置
import path from "node:path";
import { Command } from "commander";
import { runOnboard } from "./cli/onboard";
import { runDoctor } from "./cli/doctor";
import { runStart } from "./cli/start";
import { registerTraceCommands } from "./cli/trace";
import { registerTaskCommands } from "./cli/task";
import { newCliConversationSessionKey } from "./cli/cliSessionKey";
import { runRepl } from "./cli/repl";
import { runTuiCli } from "./tui/runTui";
import { registerModelCommands } from "./cli/models";

/**
 * 去掉 `tsx src/cli.ts` 等注入的脚本路径，仅保留用户真正传入的参数。
 * 若用户未传任何子命令（也无 --help / --version 等），默认进入 TUI（与全局 `oneclaw` 一致）。
 */
function ensureDefaultSubcommand(): void {
    const rest = process.argv.slice(2).filter((a) => {
        const b = path.basename(a).toLowerCase();
        return b !== "cli.ts" && b !== "cli.js" && b !== "cli.mjs";
    });
    if (rest.length === 0) {
        process.argv.push("tui");
    }
}

ensureDefaultSubcommand();

const program = new Command(); // 创建一个 Commander 实例

// 配置 CLI 的元数据
program
    .name("oneclaw")
    .description("OneClaw 本地 AI 助手")
    .version("0.1.0")
    .addHelpText(
        "after",
        `
快捷写法:
  pnpm cli t ls              同 task list（t = task）
  pnpm cli t get <taskId>    同 task get
  pnpm cli tr dir            同 trace dir（tr = trace）
  pnpm cli tr get <traceId>  同 trace get

常用任务:
  pnpm cli task create "标题" -T fix_bug
  pnpm cli task transition <id> running
  pnpm cli task approve <id>
  pnpm cli task plan <id> plan.json
  pnpm cli task review <id> --pass -m "LGTM"

终端对话（无需 HTTP）:
  pnpm cli repl
  pnpm cli repl --session mychat -v   # 续聊同一会话时指定 sessionKey
  （每次启动未带 --session 时自动新建会话 cli-<uuid>；REPL 内 / + Tab）

TUI（WebSocket + 终端界面，需较大终端窗口）:
  pnpm cli                    无子命令时默认进入 TUI
  pnpm cli tui
  pnpm cli tui -p 18789 --session mychat

全局命令（仓库根执行 pnpm link --global 且 PATH 含 PNPM_HOME 后）:
  oneclaw                     默认 TUI
  oneclaw repl / oneclaw doctor …
  pnpm oneclaw                不链全局也可（Windows 找不到 oneclaw 时用）
`
    );

// 注册子命令：onboard
program
    .command("onboard")
    .description("初始化配置与 workspace，并给出启动与访问说明")
    .action(runOnboard); // 当用户输入 `oneclaw onboard` 时，执行此函数

// 注册子命令：doctor
program
    .command("doctor")
    .description("自检 bind/auth/workspace/model 等配置，输出风险与修复建议")
    .action(runDoctor);

// 注册子命令：start
program
    .command("start")
    .description("启动 Gateway（WebChat 服务）")
    .action(runStart);

// 注册子命令：repl
program
    .command("repl")
    .description("终端对话（复用 handleUnifiedChat，无需启动 HTTP）")
    .option("--session <key>", "会话键；省略则每次启动自动新建对话（cli-<uuid>）")
    .option("--agent <id>", "Agent ID")
    .option("--task <taskId>", "关联任务 ID")
    .option("-v, --verbose", "打印 metadata（如 traceId）", false)
    .action(
        async (opts: {
            session?: string;
            agent?: string;
            task?: string;
            verbose?: boolean;
        }) => {
            await runRepl({
                sessionKey: opts.session?.trim() || newCliConversationSessionKey(),
                agentId: opts.agent,
                taskId: opts.task,
                verbose: !!opts.verbose,
            });
        }
    );  
    
program
    .command("tui")
    .description("终端图形界面（本机 WebSocket + Ink，与 REPL 同对话链）")
    .option("-p, --port <n>", "WebSocket 端口（默认 18789 或 ONECLAW_TUI_WS_PORT）")
    .option("--session <key>", "会话键；省略则每次启动自动新建对话（cli-<uuid>）")
    .option("--agent <id>", "Agent ID")
    .option("--task <taskId>", "任务 ID")
    .action(
        async (opts: {
            port?: string;
            session?: string;
            agent?: string;
            task?: string;
        }) => {
            let port: number | undefined;
            if (opts.port) {
                const n = Number.parseInt(opts.port, 10);
                if (Number.isFinite(n)) port = n;
            }
            await runTuiCli({
                port,
                session: opts.session?.trim() || newCliConversationSessionKey(),
                agent: opts.agent,
                task: opts.task,
            });
        }
    );

registerTraceCommands(program);
registerTaskCommands(program);
registerModelCommands(program);

// 解析命令行参数（这行最重要，不写它程序就没反应）
program.parse();
