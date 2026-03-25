/**
 * 定时日报调度器：在 Gateway 进程内按本地时区每天触发一次报告生成
 */

import { appConfig } from "@/config/evn";
import { generateDailyReport } from "@/reporting/dailyReportService";

/** 格式化本地日期为 YYYY-MM-DD */
function toYmdLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** 记录最近一次成功运行任务的日期，用于防止同一分钟内重复触发 */
let lastScheduledRunYmd: string | null = null;
/** 定时器句柄，用于后续停止调度 */
let intervalHandle: ReturnType<typeof setInterval> | undefined;

/**
 * 启动定时日报调度器
 */
export function startDailyReportScheduler(): void {
    // 检查配置文件是否启用了自动日报功能
    if (!appConfig.dailyReportScheduleEnabled) {
        return;
    }

    // 从配置读取设定的触发小时和分钟（例如 23:59）
    const hour = appConfig.dailyReportScheduleHour;
    const minute = appConfig.dailyReportScheduleMinute;

    console.log(
        `[OneClaw] 定时日报已启用：每天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}（本地时区）`
    );

    /** 核心检测逻辑：每 30 秒执行一次检测 */
    const tick = () => {
        const now = new Date();
        const ymd = toYmdLocal(now);

        // 1. 时间匹配检查：必须小时和分钟完全一致
        if (now.getHours() !== hour || now.getMinutes() !== minute) return;

        // 2. 幂等性检查：如果今天已经运行过了，则跳过
        if (lastScheduledRunYmd === ymd) return;

        // 标记今天已运行
        lastScheduledRunYmd = ymd;

        // 3. 异步触发日报生成逻辑
        void (async () => {
            try {
                const result = await generateDailyReport({
                    date: ymd,
                    outputPath: `reports/daily-${ymd}.md`, // 固定存储路径
                });
                console.log(
                    `[OneClaw] 定时日报已生成 date=${result.date} path=${result.outputPath} calls=${result.totalCalls}`
                );
            } catch (err) {
                console.error("[OneClaw] 定时日报生成失败:", err);
            }
        })();
    };

    // 立即执行一次检测，防止刚启动时刚好错过时间点
    tick();

    // 设置每 30 秒轮询一次（30,000 毫秒）
    intervalHandle = setInterval(tick, 30_000);
}

/**
 * 停止定时器（通常在应用关闭或热更新时调用）
 */
export function stopDailyReportScheduler(): void {
    if (intervalHandle !== undefined) {
        clearInterval(intervalHandle);
        intervalHandle = undefined;
        console.log("[OneClaw] 定时日报调度器已停止");
    }
}
