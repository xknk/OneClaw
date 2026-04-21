/**
 * 约束模型对「移动文件」类任务的拆解顺序，减少「先删源、后写目标失败」导致的数据丢失。
 * 由 chatProcessing 在未关闭 ONECLAW_FILE_RELOCATION_SAFETY_HINT 时注入为 system。
 */
import type { UiLocale } from "@/config/evn";

export function fileRelocationSafetySystemHint(locale: UiLocale): string {
    if (locale === "en") {
        return (
            "File relocation safety: Prefer one atomic OS command for move/rename (e.g. `cmd /c move …`, PowerShell " +
            "`Move-Item`, `robocopy /mov`). If you must split steps: copy or write to the destination first, confirm success, " +
            "then remove the source. Do NOT delete or empty the source while the destination write still depends on " +
            "pending human approval or an unverified write — that can cause permanent data loss. " +
            "To see what is inside a **local** folder, use `list_directory` (allowed paths) or `exec` (e.g. `dir`); " +
            "never use `fetch_url` for `D:\\\\...` or `file://` — it only supports http(s)."
        );
    }
    return (
        "文件移动安全：移动/重命名优先使用**单条**系统命令一次完成（如 cmd 的 move、PowerShell 的 Move-Item、robocopy /mov 等）。" +
        "若必须分步：**先**成功写入或复制到目标并确认，**再**删除源。在目标写入仍可能失败、或仍待人工批准时，**禁止先删除源文件**，以免内容丢失。" +
        "查看**本地**文件夹里有什么，用 list_directory（路径须在 file-access 允许范围内）或 exec（如 dir）；**不要用 fetch_url**，它只支持 http(s) 网址，不能访问 D:\\\\ 等本地路径。"
    );
}
