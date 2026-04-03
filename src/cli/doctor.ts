/**
 * OneClaw 系统自检工具
 * 职责：检查端口范围、鉴权配置、文件系统权限、以及远程 AI 模型服务状态
 */

import fs from "fs/promises";
import path from "path";
import { appConfig, ollamaConfig, PORT } from "../config/evn";
import { loadMcpServerConfigs } from "../config/mcpConfig";

type Status = "ok" | "warn" | "fail";
/**
 * 格式化输出自检结果
 * @param status 状态 (ok: 正常, warn: 警告, fail: 错误)
 * @param message 描述信息
 * @param suggestion 可选的修复建议
 */
function line(status: Status, message: string, suggestion?: string): void {
    const icon = status === "ok" ? "✓" : status === "warn" ? "!" : "✗";
    console.log(`  ${icon} ${message}`);
    if (suggestion) console.log(`    → ${suggestion}`);
}
export async function runDoctor(): Promise<void> {
    console.log("[OneClaw] 自检中...\n");
    // 1. 端口检查 (Bind Check)
    // 确保端口在 1024-65535 之间的合法非特权范围
    const port = Number(process.env.PORT) || PORT;
    if (port >= 1024 && port < 65536) {
        line("ok", `端口 ${port} 在合理范围`);
    } else {
        line("warn", `端口 ${port} 异常`, "建议设置 PORT=3000");
    }
    // 2. 鉴权检查 (Auth Check)
    // 对应之前看到的 webchatAuth 中间件，检查生产环境安全性
    if (appConfig.webchatToken) {
        line("ok", "已配置 WEBCHAT_TOKEN，WebChat 需带 token 访问");
    } else {
        line("warn", "未配置 WEBCHAT_TOKEN", "生产环境建议在 .env 中设置 WEBCHAT_TOKEN");
    }
    // 3. 工作区权限检查 (Workspace Check)
    // 不仅检查目录是否存在，还通过“创建-删除”临时文件来验证真实的写入权限
    try {
        await fs.access(appConfig.userWorkspaceDir);
        try {
            const testFile = path.join(appConfig.userWorkspaceDir, ".oneclaw_write_test");
            await fs.writeFile(testFile, ""); // 尝试写入
            await fs.unlink(testFile);        // 尝试删除
            line("ok", `Workspace 可写: ${appConfig.userWorkspaceDir}`);
        } catch {
            line("fail", "Workspace 目录不可写", `检查权限: ${appConfig.userWorkspaceDir}`);
        }
    } catch {
        line("fail", "Workspace 目录不存在", `运行 oneclaw onboard 或创建: ${appConfig.userWorkspaceDir}`);
    }

    // 4. AI 模型服务检查 (Ollama Check)
    // 检查本地或远程的 Ollama 服务是否在线，以及指定模型是否已下载
    const baseUrl = ollamaConfig.baseUrl.replace(/\/$/, "");
    try {
        // 设置 5 秒超时，防止因网络不通导致自检卡死
        const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
            line("fail", `Ollama 返回 ${res.status}`, `检查 OLLAMA_BASE_URL=${baseUrl}`);
            return;
        }

        const data = (await res.json()) as { models?: { name: string }[] };
        const names = data?.models?.map((m) => m.name) ?? [];

        // 检查配置的模型（如 llama3）是否存在于 Ollama 已拉取的列表中
        const hasModel = names.some((n) => n === ollamaConfig.modelName || n.startsWith(ollamaConfig.modelName + ":"));

        if (hasModel) {
            line("ok", `模型已拉取: ${ollamaConfig.modelName}`);
        } else {
            line("warn", `未找到模型 ${ollamaConfig.modelName}`, `可用: ${names.slice(0, 5).join(", ") || "无"}`);
        }
    } catch (e) {
        // 捕获网络连接失败（如 Ollama 未启动）
        line("fail", "无法连接 Ollama", `确认 Ollama 已启动且 OLLAMA_BASE_URL=${baseUrl}`);
    }

    // 5. MCP 服务检查 (MCP Check)
    const mcp = loadMcpServerConfigs();
    if (mcp.length) {
        line("ok", `MCP 已配置 ${mcp.length} 个 stdio 服务: ${mcp.map((x) => x.id).join(", ")}`);
    } else {
        line("ok", "未配置 MCP（不设 ONECLAW_MCP_SERVERS 则不加载外部 MCP 工具）");
    }

    // 6. 工具策略检查 (Tool-policy)
    if (appConfig.execEnabled) {
        line("warn", "exec 工具已启用，可执行任意 shell 命令", "仅在受控环境使用；可通过 ONECLAW_EXEC_ENABLED=false 关闭");
    } else {
        line("ok", "exec 工具已关闭（ONECLAW_EXEC_ENABLED=false）");
    }

    // 7. V4 任务存储目录（ tasks/*.json ）
    const tasksDir = path.join(appConfig.dataDir, "tasks");
    try {
        await fs.mkdir(tasksDir, { recursive: true });
        const testFile = path.join(tasksDir, ".oneclaw_write_test");
        await fs.writeFile(testFile, "");
        await fs.unlink(testFile);
        line("ok", `任务目录可写: ${tasksDir}`);
    } catch {
        line("fail", "任务目录不可写或无法创建", `检查权限: ${tasksDir}`);
    }

    // 8. 任务高风险审批开关（提示）
    if (appConfig.taskHighRiskApprovalEnabled) {
        line("ok", "V4 已启用任务高风险工具审批（ONECLAW_TASK_HIGH_RISK_APPROVAL，关联 taskId 时对 riskLevel=high 及 exec/apply_patch 拦截）");
    } else {
        line("warn", "任务高风险审批已关闭", "生产环境建议 ONECLAW_TASK_HIGH_RISK_APPROVAL=true");
    }

    console.log("\n[OneClaw] 自检结束。");
}
