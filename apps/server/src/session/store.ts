/**
 * 会话元数据存储：sessions.json
 * 作用：管理用户/群组与底层模型对话 ID 的对应关系，并持久化上下文归档状态（摘要、计数、错误统计）
 */

import fs from "fs/promises";
import path from "path";
import type { SessionKey, SessionStore } from "./type";
import { appConfig } from "../config/evn";
import crypto from "node:crypto";

let agentIdKey: string = 'main';

// --- 【类型定义】 ---

/** 
 * 滚动上下文状态
 * 用于 buildMessagesForModel 函数，控制 AI 摘要逻辑
 */
export type RollingState = {
    rollingSummary: string;      // 当前会话的历史背景摘要
    archivedMessageCount: number; // 已被并入摘要的消息总数
    consecutiveFailures: number;  // 新增：连续 AI 压缩失败次数，用于触发断路器逻辑
};

export type SessionListEntry = {
    sessionKey: string;
    sessionId: string;
    updatedAt: string;
};

// --- 【路径管理】 ---

/** 获取会话存放的文件夹路径：[数据目录]/agents/[agentId]/sessions */
function getSessionsDir(agentId: string = agentIdKey): string {
    return path.join(appConfig.dataDir, "agents", agentId, "sessions");
}

/** 获取对话详细转录文件 (.jsonl) 的路径 */
function transcriptPathForSession(sessionId: string, agentId: string): string {
    return path.join(getSessionsDir(agentId), `${sessionId}.jsonl`);
}

/** 获取 JSON 索引文件的完整路径：.../sessions/sessions.json */
function getStorePath(agentId: string = agentIdKey): string {
    return path.join(getSessionsDir(agentId), "sessions.json");
}

// --- 【核心存储操作】 ---

/** 递归创建目录：确保文件夹存在，防止写入时报错 */
export async function ensureSessionsDir(agentId: string = agentIdKey): Promise<void> {
    await fs.mkdir(getSessionsDir(agentId), { recursive: true });
}

/** 从硬盘读取整个会话数据库 */
export async function readStore(agentId: string = agentIdKey): Promise<SessionStore> {
    await ensureSessionsDir(agentId);
    const p = getStorePath(agentId);
    try {
        const raw = await fs.readFile(p, "utf-8");
        const store = JSON.parse(raw) as SessionStore;
        return typeof store === "object" && store !== null ? store : {};
    } catch (err: unknown) {
        // 如果文件不存在 (ENOENT)，返回空对象
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
        throw err;
    }
}

/** 将会话对象持久化保存到硬盘 */
export async function writeStore(store: SessionStore, agentId: string = agentIdKey): Promise<void> {
    await ensureSessionsDir(agentId);
    // 使用 2 空格缩进保存，方便开发者人工排查数据
    await fs.writeFile(getStorePath(agentId), JSON.stringify(store, null, 2), "utf-8");
}

/** 生成一个新的随机 ID (UUID) */
export function createSessionId(): string {
    return crypto.randomUUID();
}

// --- 【会话生命周期管理】 ---

/** 
 * 获取或创建 SessionId
 * @param sessionKey 标识用户的唯一键
 */
export async function getOrCreateSessionId(sessionKey: SessionKey, agentId: string = agentIdKey): Promise<string> {
    const store = await readStore(agentId);
    let entry = store[sessionKey];
    
    if (!entry) {
        // 初始化新会话：增加 consecutiveFailures 默认值
        entry = {
            sessionId: createSessionId(),
            updatedAt: new Date().toISOString(),
            archivedMessageCount: 0,
            rollingSummary: "",
            consecutiveFailures: 0, // 初始化失败计数为 0
        } as any; 
        store[sessionKey] = entry;
        await writeStore(store, agentId);
    }
    return entry.sessionId;
}

/** 
 * 重置会话：分配新 ID，清空摘要和失败计数 
 */
export async function resetSession(sessionKey: SessionKey, agentId: string = agentIdKey): Promise<string> {
    const store = await readStore(agentId);
    const sessionId = createSessionId();
    store[sessionKey] = {
        sessionId,
        updatedAt: new Date().toISOString(),
        archivedMessageCount: 0,
        rollingSummary: "",
        consecutiveFailures: 0, // 重置时清除错误记录
    } as any;
    await writeStore(store, agentId);
    return sessionId;
}

/** 
 * 获取当前会话的上下文归档状态
 * 返回数据将直接用于 buildMessagesForModel 的断路器判断
 */
export async function getRollingState(
    sessionKey: SessionKey,
    agentId: string = agentIdKey
): Promise<RollingState> {
    const store = await readStore(agentId);
    const e = store[sessionKey];
    
    if (!e) {
        return { rollingSummary: "", archivedMessageCount: 0, consecutiveFailures: 0 };
    }

    return {
        rollingSummary: typeof e.rollingSummary === "string" ? e.rollingSummary : "",
        archivedMessageCount:
            typeof e.archivedMessageCount === "number" && e.archivedMessageCount >= 0
                ? e.archivedMessageCount
                : 0,
        // 读取持久化的连续失败次数，若不存在则默认为 0
        consecutiveFailures: 
            typeof (e as any).consecutiveFailures === "number" ? (e as any).consecutiveFailures : 0,
    };
}

/** 
 * 保存归档状态：当上下文合并成功或失败时，由 builder 调用更新 
 */
export async function setRollingState(
    sessionKey: SessionKey,
    agentId: string,
    state: RollingState
): Promise<void> {
    const store = await readStore(agentId);
    const e = store[sessionKey];
    if (!e) return;

    e.rollingSummary = state.rollingSummary;
    e.archivedMessageCount = state.archivedMessageCount;
    // 关键：将失败计数同步回存储层
    (e as any).consecutiveFailures = state.consecutiveFailures;
    
    await writeStore(store, agentId);
}

/** 更新活跃时间：标记最后一次交互 */
export async function touchSession(sessionKey: SessionKey, agentId: string = agentIdKey): Promise<void> {
    const store = await readStore(agentId);
    const entry = store[sessionKey];
    if (entry) {
        entry.updatedAt = new Date().toISOString();
        await writeStore(store, agentId);
    }
}

// --- 【管理功能】 ---

/** 列出当前 Agent 下所有会话键 */
export async function listSessionEntries(agentId: string = agentIdKey): Promise<SessionListEntry[]> {
    const store = await readStore(agentId);
    return Object.entries(store).map(([sessionKey, v]) => ({
        sessionKey,
        sessionId: v.sessionId,
        updatedAt: v.updatedAt,
    }));
}

/** 删除会话映射并清理对应的转录文件 */
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
