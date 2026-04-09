/**
 * 日报生成工具模块
 * 该工具允许 AI Agent 调用文件系统中的日志数据并产出 Markdown 报告
 */
import type { Tool } from "../types";
import { generateDailyReport } from "@/reporting/dailyReportService";

/**
 * 创建并返回“生成日报”工具实例
 * @returns 符合 Agent 调用标准的 Tool 对象
 */
export function generateDailyReportTool(): Tool {
    return {
        // 工具的唯一标识符，AI 会根据这个名字来决定调用哪个工具
        name: "generate_daily_report",

        // 工具的描述信息，这是给 AI 看的“说明书”
        // AI 靠这段文字理解：什么时候该用这个工具，它能干什么
        description:
            "根据工具调用日志生成日报。可以指定日期(date)、会话(sessionKey)或智能体(agentId)进行过滤，生成的 Markdown 文件将写入工作区(workspace)。",

        /**
         * 执行逻辑：当 AI 决定调用此工具时运行
         * @param args AI 提取出的参数对象，可能包含 date, sessionKey, agentId, outputPath
         */
        async execute(args) {
            // 1. 参数提取与类型防御：确保从 AI 传来的动态对象中安全地获取字符串
            const date = typeof args?.date === "string" ? args.date : undefined;
            const sessionKey = typeof args?.sessionKey === "string" ? args.sessionKey : undefined;
            const agentId = typeof args?.agentId === "string" ? args.agentId : undefined;
            const outputPath = typeof args?.outputPath === "string" ? args.outputPath : undefined;

            try {
                // 2. 调用核心业务逻辑：执行实际的文件读取、过滤和 Markdown 写入
                const result = await generateDailyReport({
                    date,
                    sessionKey,
                    agentId,
                    outputPath,
                });

                // 3. 返回给 AI 的成功信息：
                // 这一段字符串会被 AI 读到，AI 会根据这些数据组织语言回复用户
                return [
                    "✅ 日报生成成功",
                    `日期: ${result.date}`,
                    `保存路径: ${result.outputPath}`,
                    `总调用次数: ${result.totalCalls}`,
                    `成功次数: ${result.successCalls}`,
                    `失败次数: ${result.failedCalls}`,
                    `使用工具数: ${result.uniqueTools}`,
                ].join("\n");

            } catch (err) {
                // 4. 异常处理：如果生成过程中报错，将错误信息返回给 AI
                // 这样 AI 就能告诉用户：“抱歉，因为某某原因，我没能生成报告。”
                return `❌ 日报生成失败: ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    };
}
