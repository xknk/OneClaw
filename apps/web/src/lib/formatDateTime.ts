import type { UiLocale } from "@/locale/types";

/**
 * 将 ISO 时间字符串格式化为本地可读形式（全站 UI 统一用此函数展示时间）。
 */
export function formatDateTime(
    iso: string | undefined | null,
    locale: UiLocale = "zh",
): string {
    if (iso == null || String(iso).trim() === "") {
        return "—";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return String(iso);
    }
    const tag = locale === "en" ? "en-US" : "zh-CN";
    return d.toLocaleString(tag, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}