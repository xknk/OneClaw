/**
 * oneclaw start：启动 Gateway
 */

import { createServer } from "../server/createServer";
import { PORT, appConfig } from "../config/evn";
import { startDailyReportScheduler } from "../jobs/dailyReportScheduler";
import { loadAgentRegistryFromWorkspace } from "../agent/loadAgentRegistry";

export async function runStart(): Promise<void> {
    // 加载 Agent 注册表
    await loadAgentRegistryFromWorkspace();
    // 创建服务器
    const app = createServer();
    const host = appConfig.bindHost;
    // 启动服务器
    app.listen(PORT,host, () => {
        console.log(`[OneClaw] Gateway 已启动 http://${host}:${PORT}`);
        // 启动日报调度器
        startDailyReportScheduler();
    });
}