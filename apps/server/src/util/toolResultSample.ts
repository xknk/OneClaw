/**
 * 超长工具输出：头尾保留 + 中间折叠，降低上下文占用（optimize §5）
 */
export function sampleLongToolResult(
    text: string,
    opts: { maxChars: number; headChars: number; tailChars: number },
): string {
    if (!text || text.length <= opts.maxChars) return text;
    const { headChars, tailChars } = opts;
    if (headChars + tailChars + 80 >= text.length) return text;
    const omitted = text.length - headChars - tailChars;
    return (
        text.slice(0, headChars) +
        `\n\n… [OneClaw: 已省略中间 ${omitted} 字符，完整结果已在服务端落盘/审计；可缩小命令输出或分段读取] …\n\n` +
        text.slice(-tailChars)
    );
}
