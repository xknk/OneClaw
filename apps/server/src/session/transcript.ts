/**
 * 会话转录：每条会话一个 .jsonl 文件
 * 作用：真实保存每一场对话的具体内容
 */

import fs from "fs/promises";
import path from "path";
import type { ChatMessage } from "../llm/providers/ModelProvider";
import type { TranscriptLine } from "./type";
import { appConfig } from "../config/evn";
import { ensureSessionsDir } from "./store";
import crypto from "node:crypto";


/** 获取该 Agent 的会话存储根目录 */
function getSessionsDir(agentId: string = 'main'): string {
    return path.join(appConfig.dataDir, "agents", agentId, "sessions");
}

/** 
 * 根据 sessionId 获取具体的聊天记录文件路径 
 * 路径示例：.../sessions/uuid-123-456.jsonl
 */
export function getTranscriptPath(sessionId: string, agentId: string = 'main'): string {
    return path.join(getSessionsDir(agentId), `${sessionId}.jsonl`);
}

/** 辅助函数：将存储格式的行 (TranscriptLine) 转换为模型需要的消息格式 (ChatMessage) */
function lineToMessage(line: TranscriptLine): ChatMessage {
    return { role: line.role, content: line.content };
}

/** 
 * 从 .jsonl 读取某次对话的全部上下文 
 * 用于在发起 API 请求前，把之前的记忆带上
 */
export async function readMessages(sessionId: string, agentId: string = 'main'): Promise<ChatMessage[]> {
    // 确保目录存在
    await ensureSessionsDir(agentId);
    const p = getTranscriptPath(sessionId, agentId);
    try {
        const text = await fs.readFile(p, "utf-8");
        // 将文件内容按行拆分，每行解析为一个 JSON 对象
        const lines = text
            .trim()
            .split("\n")
            .filter((s) => s.length > 0) // 过滤掉空行
            .map((s) => JSON.parse(s) as TranscriptLine);

        return lines.map(lineToMessage);
    } catch (err: unknown) {
        // 如果文件不存在（新会话），返回空数组作为历史记录
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
        throw err;
    }
}

/** 
 * 追加一条消息到转录文件末尾 
 * 每次用户说话或模型回复时，都会调用此函数
 */
export async function appendMessage(
    sessionId: string,
    role: TranscriptLine["role"],
    content: string,
    agentId: string,
): Promise<void> {
    await ensureSessionsDir(agentId);

    // 构建单条记录，并生成唯一的消息 ID
    const line: TranscriptLine = {
        id: crypto.randomUUID(),
        role,
        content,
    };

    const p = getTranscriptPath(sessionId, agentId);
    // 使用 appendFile 直接在文件末尾追加，效率极高
    await fs.appendFile(p, JSON.stringify(line) + "\n", "utf-8");
}
