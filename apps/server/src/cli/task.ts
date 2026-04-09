import { Command } from "commander";
import {
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

function needTaskIdHint(cmd: string): string {
    return `请提供任务 ID，例如：pnpm cli ${cmd} <taskId> 或 -i <taskId>`;
}

function resolveOne(
    pos: string | undefined,
    opt: string | undefined,
    cmd: string
): string {
    const id = (pos?.trim() || opt?.trim() || "").trim();
    if (!id) {
        console.error(needTaskIdHint(cmd));
        process.exitCode = 1;
    }
    return id;
}

export function registerTaskCommands(program: Command): void {
    const task = program.command("task").description("任务工作流（本地 JSON）");
    task.alias("t");

    task
        .command("create")
        .description("创建任务（draft）")
        .argument("[title]", "标题（也可用 -t）")
        .option("-t, --title <t>", "标题")
        .option("-T, --template <id>", "模板 ID")
        .action(async (titleArg: string | undefined, opts: { title?: string; template?: string }) => {
            const title = (titleArg?.trim() || opts.title?.trim() || undefined) ?? undefined;
            const rec = await createTask({
                title,
                templateId: opts.template,
            });
            console.log(JSON.stringify(rec, null, 2));
        });

    task
        .command("list")
        .description("列出最近任务")
        .alias("ls")
        .option("-n, --limit <n>", "条数", "20")
        .option("-s, --status <s>", "按状态过滤")
        .option("-f, --failed-only", "仅失败", false)
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

    task
        .command("get")
        .description("按 ID 查看任务")
        .argument("[taskId]", "任务 ID")
        .option("-i, --id <taskId>", "任务 ID（与位置参数二选一）")
        .action(async (taskId: string | undefined, opts: { id?: string }) => {
            const id = resolveOne(taskId, opts.id, "task get");
            if (!id) return;
            const rec = await getTask(id);
            if (!rec) {
                console.error("任务不存在");
                process.exitCode = 1;
                return;
            }
            console.log(JSON.stringify(rec, null, 2));
        });

    task
        .command("transition")
        .description("状态迁移")
        .argument("[taskId]", "任务 ID")
        .argument("[to]", "目标状态")
        .option("-i, --id <taskId>", "任务 ID")
        .option("-t, --to <status>", "目标状态")
        .option("-r, --reason <r>", "原因")
        .action(
            async (
                taskId: string | undefined,
                toPos: string | undefined,
                opts: { id?: string; to?: string; reason?: string }
            ) => {
                const id = resolveOne(taskId, opts.id, "task transition");
                if (!id) return;
                const toRaw = (toPos?.trim() || opts.to?.trim() || "").trim();
                if (!toRaw) {
                    console.error("请提供目标状态，例如：pnpm cli task transition <id> running 或 -t running");
                    process.exitCode = 1;
                    return;
                }
                const to = parseTaskStatus(toRaw);
                if (!to) {
                    console.error("无效的 --to / 状态");
                    process.exitCode = 1;
                    return;
                }
                try {
                    const rec = await transitionTask(id, {
                        to,
                        reason: opts.reason,
                    });
                    console.log(JSON.stringify(rec, null, 2));
                } catch (e) {
                    console.error(e instanceof Error ? e.message : e);
                    process.exitCode = 1;
                }
            }
        );

    task
        .command("templates")
        .description("列出内置任务模板")
        .alias("tpl")
        .action(() => {
            console.log(JSON.stringify(listTaskTemplateSummaries(), null, 2));
        });

    task
        .command("plan")
        .description("提交 Planner 计划（覆盖 v4_plan）")
        .argument("[taskId]", "任务 ID")
        .argument("[file]", "JSON 文件路径")
        .option("-i, --id <taskId>", "任务 ID")
        .option("-f, --file <path>", "JSON 文件，含 { steps, plannerNote? }")
        .action(
            async (
                taskId: string | undefined,
                filePos: string | undefined,
                opts: { id?: string; file?: string }
            ) => {
                const id = resolveOne(taskId, opts.id, "task plan");
                if (!id) return;
                const file = (filePos?.trim() || opts.file?.trim() || "").trim();
                if (!file) {
                    console.error("请提供计划文件，例如：pnpm cli task plan <id> plan.json 或 -f plan.json");
                    process.exitCode = 1;
                    return;
                }
                const fs = await import("node:fs/promises");
                const raw = await fs.readFile(file, "utf-8");
                const body = JSON.parse(raw) as { steps?: unknown; plannerNote?: string };
                try {
                    const rec = await setTaskPlan(id, {
                        steps: body.steps,
                        plannerNote: body.plannerNote,
                    });
                    console.log(JSON.stringify(rec, null, 2));
                } catch (e) {
                    console.error(e instanceof Error ? e.message : e);
                    process.exitCode = 1;
                }
            }
        );

    task
        .command("review")
        .description("提交评审（任务须为 review）")
        .argument("[taskId]", "任务 ID")
        .option("-i, --id <taskId>", "任务 ID")
        .option("--pass", "通过", false)
        .option("--fail", "不通过", false)
        .option("-m, --summary <s>", "摘要")
        .option("--findings <json>", "JSON 数组字符串", "[]")
        .action(
            async (
                taskId: string | undefined,
                opts: { id?: string; pass?: boolean; fail?: boolean; summary?: string; findings: string }
            ) => {
                const id = resolveOne(taskId, opts.id, "task review");
                if (!id) return;
                const pass = !!opts.pass;
                const fail = !!opts.fail;
                if (pass === fail) {
                    console.error("请仅指定 --pass 或 --fail 之一");
                    process.exitCode = 1;
                    return;
                }
                const summary = (opts.summary ?? "").trim();
                if (!summary) {
                    console.error("请提供摘要：-m \"...\"" );
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
                    const rec = await submitReviewVerdict(id, {
                        outcome: pass ? "pass" : "fail",
                        summary,
                        findings,
                    });
                    console.log(JSON.stringify(rec, null, 2));
                } catch (e) {
                    console.error(e instanceof Error ? e.message : e);
                    process.exitCode = 1;
                }
            }
        );

    task
        .command("approve")
        .description("人工批准高风险工具（任务须为 pending_approval）")
        .argument("[taskId]", "任务 ID")
        .option("-i, --id <taskId>", "任务 ID")
        .option("-c, --comment <c>", "备注")
        .action(async (taskId: string | undefined, opts: { id?: string; comment?: string }) => {
            const id = resolveOne(taskId, opts.id, "task approve");
            if (!id) return;
            try {
                const rec = await approvePendingTask(id, opts.comment);
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });

    task
        .command("export")
        .description("导出任务报告（json / md），默认 stdout")
        .argument("[taskId]", "任务 ID")
        .option("-i, --id <taskId>", "任务 ID")
        .option("-f, --format <f>", "json | md", "json")
        .option("-o, --out <path>", "写入文件路径")
        .action(async (taskId: string | undefined, opts: { id?: string; format: string; out?: string }) => {
            const id = resolveOne(taskId, opts.id, "task export");
            if (!id) return;
            const fmt = parseExportFormat(opts.format);
            if (!fmt) {
                console.error("format 须为 json、md 或 markdown");
                process.exitCode = 1;
                return;
            }
            const rec = await getTask(id);
            if (!rec) {
                console.error("任务不存在");
                process.exitCode = 1;
                return;
            }
            const body = fmt === "json" ? buildTaskReportJson(rec) : renderTaskReportMarkdown(rec);
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
        .argument("[taskId]", "任务 ID")
        .option("-i, --id <taskId>", "任务 ID")
        .option("-x, --trace-id <traceId>", "可选 traceId")
        .action(async (taskId: string | undefined, opts: { id?: string; traceId?: string }) => {
            const id = resolveOne(taskId, opts.id, "task run");
            if (!id) return;
            try {
                const rec = await runTask(id, opts.traceId);
                console.log(JSON.stringify(rec, null, 2));
            } catch (e) {
                console.error(e instanceof Error ? e.message : e);
                process.exitCode = 1;
            }
        });
}
