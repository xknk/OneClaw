/**
 * 将 HTML 粗提为纯文本（用于 fetch_readable；不保证与浏览器渲染一致）。
 */
export function htmlToPlainText(html: string): string {
    let s = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
    s = s.replace(/<[^>]+>/g, " ");
    s = s.replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"');
    s = s.replace(/[ \t\f\v]+/g, " ");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
}
