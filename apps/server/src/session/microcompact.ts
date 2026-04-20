import path from "node:path";
import { appConfig } from "@/config/evn";
import { getFileAccessRoots } from "@/agent/tools/workspace";

/** ANSI / OSC 转义序列（终端着色等） */
const ANSI_ESCAPE = /\u001b\[[\d;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/**
 * 将常见绝对路径替换为相对 workspace 的写法，缩短 system/tool 消息 token（optimize §3）
 */
export function relativizeWorkspacePathsInText(text: string): string {
    if (!text) return text;
    const roots = new Set<string>();
    try {
        roots.add(path.resolve(appConfig.userWorkspaceDir));
        for (const r of getFileAccessRoots()) {
            try {
                roots.add(path.resolve(r));
            } catch {
                /* ignore */
            }
        }
    } catch {
        return text.replace(ANSI_ESCAPE, "");
    }
    let out = text;
    for (const root of roots) {
        const norm = root.replace(/\\/g, "/");
        if (norm.length < 3) continue;
        const re = new RegExp(
            norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\/|\\\\|$)",
            "gi",
        );
        out = out.replace(re, "./$1");
    }
    return out;
}

export function stripAnsi(text: string): string {
    return text.replace(ANSI_ESCAPE, "");
}

/**
 * 单条消息内容微压缩：ANSI、多余空白、HTML 注释；路径相对化
 */
export function microcompactTextContent(raw: string): string {
    let s = stripAnsi(raw || "");
    s = s.replace(/<!--[\s\S]*?-->/g, "");
    s = relativizeWorkspacePathsInText(s);
    s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{3,}/g, " ").trim();
    return s;
}
