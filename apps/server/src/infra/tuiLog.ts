/**
 * TUI（Ink）与 stderr/stdout 混写会导致整屏重绘闪烁。
 * 在 ONECLAW_TUI=1 时跳过向控制台打印非关键日志。
 */
export function isTuiSession(): boolean {
    return process.env.ONECLAW_TUI === "1";
}

/** 非 TUI 会话才输出到 stderr，避免与 Ink 抢占终端 */
export function logErrorUnlessTui(...args: unknown[]): void {
    if (isTuiSession()) return;
    console.error(...args);
}
