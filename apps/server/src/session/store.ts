/**
 * 会话元数据存储：sessions.json
 * 作用：管理用户/群组与底层模型对话 ID 的对应关系
 */

import fs from "fs/promises";
import path from "path";
import type { SessionKey, SessionStore } from "./type";
import { appConfig } from "../config/evn";
import crypto from "node:crypto";
let agentIdKey:string = 'main';
/** 获取会话存放的文件夹路径：[数据目录]/agents/main/sessions */
function getSessionsDir(agentId:string  = agentIdKey): string {
    return path.join(appConfig.dataDir, "agents", agentId , "sessions");
}

function transcriptPathForSession(sessionId: string, agentId: string): string {
    return path.join(getSessionsDir(agentId), `${sessionId}.jsonl`);
}

/** 获取 JSON 文件的完整路径：.../sessions/sessions.json */
function getStorePath(agentId:string = agentIdKey): string {
    return path.join(getSessionsDir(agentId), "sessions.json");
}

/** 递归创建目录：确保文件夹存在，防止写入时报错 */
export async function ensureSessionsDir(agentId:string = agentIdKey): Promise<void> {
    await fs.mkdir(getSessionsDir(agentId), { recursive: true });
}

/** 从硬盘读取整个会话数据库 */
export async function readStore(agentId:string = agentIdKey): Promise<SessionStore> {
    await ensureSessionsDir(agentId);
    const p = getStorePath(agentId);
    try {
        const raw = await fs.readFile(p, "utf-8");
        const store = JSON.parse(raw) as SessionStore;
        // 简单校验格式，确保返回一个对象
        return typeof store === "object" && store !== null ? store : {};
    } catch (err: unknown) {
        // 如果文件不存在 (ENOENT)，说明是第一次运行，返回空对象
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
        throw err;
    }
}

/** 将会话对象持久化保存到硬盘 */
export async function writeStore(store: SessionStore, agentId:string = agentIdKey): Promise<void> {
    await ensureSessionsDir(agentId);
    // 使用 JSON.stringify 格式化输出（2空格缩进），方便人工查看
    await fs.writeFile(getStorePath(agentId), JSON.stringify(store, null, 2), "utf-8");
}

/** 生成一个新的随机 ID (UUID) */
export function createSessionId(): string {
    return crypto.randomUUID();
}

/** 
 * 获取或创建 SessionId
 * @param sessionKey 标识用户的唯一键（如 "user_123"）
 * @returns 现有的或新生成的 sessionId
 */
export async function getOrCreateSessionId(sessionKey: SessionKey, agentId:string = agentIdKey): Promise<string> {
    const store = await readStore(agentId);
    let entry = store[sessionKey];
    
    if (!entry) {
        // 如果没记录过这个用户，创建新会话
        entry = {
            sessionId: createSessionId(),
            updatedAt: new Date().toISOString(),
        };
        store[sessionKey] = entry;
        await writeStore(store); // 存入硬盘
    }
    return entry.sessionId;
}

/** 
 * 重置会话：丢弃旧的 ID，分配新的，相当于“开启新对话” 
 */
export async function resetSession(sessionKey: SessionKey, agentId:string = agentIdKey): Promise<string> {
    const store = await readStore(agentId);
    const sessionId = createSessionId();
    store[sessionKey] = {
        sessionId,
        updatedAt: new Date().toISOString(),
    };
    await writeStore(store);
    return sessionId;
}

/** 
 * 更新活跃时间：每次用户说话后调用，记录最后一次交互时间 
 */
export async function touchSession(sessionKey: SessionKey, agentId:string = agentIdKey): Promise<void> {
    const store = await readStore(agentId);
    const entry = store[sessionKey];
    if (entry) {
        entry.updatedAt = new Date().toISOString();
        await writeStore(store);
    }
}

export type SessionListEntry = {
    sessionKey: string;
    sessionId: string;
    updatedAt: string;
};

/**
 * 列出当前 Agent 下所有会话键（用于管理端展示）。
 */
export async function listSessionEntries(agentId: string = agentIdKey): Promise<SessionListEntry[]> {
    const store = await readStore(agentId);
    return Object.entries(store).map(([sessionKey, v]) => ({
        sessionKey,
        sessionId: v.sessionId,
        updatedAt: v.updatedAt,
    }));
}

/**
 * 删除会话映射并尽量删除对应 .jsonl 转录文件（不存在则忽略）。
 */
export async function deleteSessionEntry(sessionKey: SessionKey, agentId: string = agentIdKey): Promise<boolean> {
    const store = await readStore(agentId);
    const entry = store[sessionKey];
    if (!entry) return false;
    const sid = entry.sessionId;
    delete store[sessionKey];
    await writeStore(store, agentId);
    try {
        await fs.unlink(transcriptPathForSession(sid, agentId));
    } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw e;
    }
    return true;
}
