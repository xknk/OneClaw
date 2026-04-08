import { Command } from "commander";
import {
    cancelTask,
    createTask,
    getTask,
    listTasks,
    parseTaskStatus,
    transitionTask,
} from "@/tasks/taskService";
import { setTaskPlan, submitReviewVerdict } from "@/tasks/collaborationService";
import { listTaskTemplateSummaries } from "@/tasks/templates";
import { approvePendingTask } from "@/tasks/taskApproval";
import { buildTaskReportJson, renderTaskReportMarkdown, parseExportFormat } from "@/tasks/taskReport";
import { runTask } from "@/tasks/taskRunner";
/**
 * 注册任务相关的命令行指令
 * @param program Commander 的主程序实例
 */
export function registerTaskCommands(program: Command): void {
    // 创建一个名为 "task" 的父级命令组
    // 使用方式：node main.js task [子命令]
    const task = program.command("task").description("V4 任务工作流（本地 JSON 存储）");

    /**
     * 子命令：create
     * 示例：node main.js task create --title "测试任务"
     */
    task
        .command("create")
        .description("创建任务（draft）")
        .option("--title <t>", "标题")         // <t> 表示必填参数值
        .option("--template <id>", "模板 ID")
        .action(async (opts: { title?: string; template?: string }) => {
            // 调用 Service 层创建任务
            const rec = await createTask({
                title: opts.title,
                templateId: opts.template,
            });
            // 将结果以格式化的 JSON 打印到终端
            console.log(JSON.stringify(rec, null, 2));
        });

    /**
     * 子命令：list
     * 示例：node main.js task list --limit 10 --status running
     */
    task
        .command("list")
        .description("列出最近任务")
        .option("--limit <n>", "条数", "20")   // 第三个参数 "20" 是默认值
        .option("--status <s>", "按状态过滤")
        .option("--failed-only", "仅失败", false) // 布尔值选项
        .action(async (opts: { limit: string; status?: string; failedOnly: boolean }) => {
            const limit = Math.max(1, Math.min(200, Number(opts.limit) || 20));
            const status = parseTaskStatus(opts.status ?? "");
            const rows = await listTasks({
                limit,
                status,
                failedOnly: !!opts.failedOnly,
            });
            console.log(JSON.stringify(rows, null, 2));
        });

    /**
     * 子命令：get
     * 示例：node main.js task get --id <UUID>
     */
    task
        .command("get")
        .description("按 ID 查看任务")
        .requiredOption("--id <taskId>", "taskId") // requiredOption 表示必须提供该参数
        .action(async (opts: { id: string }) => {
            const rec = await getTask(opts.id.trim());
            if (!rec) {
                console.error("任务不存在");
                process.exitCode = 1; // 设置进程退出码为 1 表示失败
                return;
            }
            console.log(JSON.stringify(rec, null, 2));
        });

    /**
     * 子命令：transition
     * 示例：node main.js task transition --id <ID> --to done --reason "手动完成"
     */
    task
        .command("transition")
        .description("状态迁移")
        .requiredOption("--id <taskId>", "taskId")
        .requiredOption("--to <status>", "目标状态")
        .option("--reason <r>", "原因")
        .action(async (opts: { id: string; to: string; reason?: string }) => {
            const to = parseTaskStatus(opts.to);
            if (!to) {
                console.error("无效的 --to");
                process.exitCode = 1;
                return;
            }
            try {
                const rec = await transitionTask(opts.id, {
                    to,
                    reason: opts.reason,
                });
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                // 捕获状态机抛出的非法转换异常（如：done 不能跳到 running）
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });
    task
        .command("templates")
        .description("列出内置任务模板")
        .action(() => {
            console.log(JSON.stringify(listTaskTemplateSummaries(), null, 2));
        });

    task
        .command("plan")
        .description("提交 Planner 计划（覆盖 v4_plan）")
        .requiredOption("--id <taskId>", "taskId")
        .requiredOption("--file <path>", "JSON 文件，含 { steps: [...], plannerNote?: string }")
        .action(async (opts: { id: string; file: string }) => {
            const fs = await import("node:fs/promises");
            const raw = await fs.readFile(opts.file, "utf-8");
            const body = JSON.parse(raw) as { steps?: unknown; plannerNote?: string };
            try {
                const rec = await setTaskPlan(opts.id, {
                    steps: body.steps,
                    plannerNote: body.plannerNote,
                });
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });
    task
        .command("review")
        .description("提交评审（任务须为 review）")
        .requiredOption("--id <taskId>", "taskId")
        .option("--pass", "通过", false)
        .option("--fail", "不通过", false)
        .requiredOption("--summary <s>", "摘要")
        .option("--findings <json>", "JSON 数组字符串，如 [\"a\",\"b\"]", "[]")
        .action(async (opts: { id: string; pass?: boolean; fail?: boolean; summary: string; findings: string }) => {
            const pass = !!opts.pass;
            const fail = !!opts.fail;
            if (pass === fail) {
                console.error("请仅指定 --pass 或 --fail 之一");
                process.exitCode = 1;
                return;
            }
            let findings: unknown = [];
            try {
                findings = JSON.parse(opts.findings || "[]");
            } catch {
                console.error("findings 须为合法 JSON 数组");
                process.exitCode = 1;
                return;
            }
            try {
                const rec = await submitReviewVerdict(opts.id, {
                    outcome: pass ? "pass" : "fail",
                    summary: opts.summary,
                    findings,
                });
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });

    task
        .command("approve")
        .description("人工批准高风险工具（任务须为 pending_approval）")
        .requiredOption("--id <taskId>", "taskId")
        .option("--comment <c>", "备注")
        .action(async (opts: { id: string; comment?: string }) => {
            try {
                const rec = await approvePendingTask(opts.id, opts.comment);
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });


    task
        .command("export")
        .description("导出任务报告（json / md），默认 stdout")
        .requiredOption("--id <taskId>", "taskId")
        .option("--format <f>", "json | md", "json")
        .option("--out <path>", "写入文件路径（可选）")
        .action(async (opts: { id: string; format: string; out?: string }) => {
            const fmt = parseExportFormat(opts.format);
            if (!fmt) {
                console.error("format 须为 json、md 或 markdown");
                process.exitCode = 1;
                return;
            }
            const rec = await getTask(opts.id.trim());
            if (!rec) {
                console.error("任务不存在");
                process.exitCode = 1;
                return;
            }
            const body =
                fmt === "json" ? buildTaskReportJson(rec) : renderTaskReportMarkdown(rec);
            if (opts.out?.trim()) {
                const fs = await import("node:fs/promises");
                await fs.writeFile(opts.out.trim(), body, "utf-8");
            } else {
                console.log(body);
            }
        });

    task
        .command("run")
        .description("按 v4_plan 连续执行任务（Runner）")
        .requiredOption("--id <taskId>", "taskId")
        .option("--trace-id <traceId>", "可选 traceId")
        .action(async (opts: { id: string; traceId?: string }) => {
            try {
                const rec = await runTask(opts.id.trim(), opts.traceId);
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });
}
