import { randomUUID } from "node:crypto";

/** 终端 REPL/TUI 每次启动的默认会话键（与 Web 侧 u- / guest- 前缀区分） */
export function newCliConversationSessionKey(): string {
    return `cli-${randomUUID()}`;
}
