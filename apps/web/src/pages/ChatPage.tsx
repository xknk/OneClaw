import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ChatMessage, Conversation } from "@/chat/types";
import { useAuth } from "@/auth/AuthContext";
import { apiChat, apiSessionReset } from "@/api/client";
import { ChatSidebar } from "@/components/ChatSidebar";
import { Button, Card, Input, TextArea } from "@/components/ui";
import { createEmptyConversation, loadConversations, saveConversations } from "@/lib/conversationStore";
import { ensureRegistered, getProfile } from "@/lib/localUser";

export function ChatPage() {
    const { hasToken } = useAuth();

    const [guestSessionKey, setGuestSessionKey] = useState(() => `guest-${crypto.randomUUID()}`);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const [agentId, setAgentId] = useState("main");
    const [intent, setIntent] = useState("");
    const [taskId, setTaskId] = useState("");
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevActiveId = useRef<string | null>(null);

    const activeConv = activeId ? conversations.find((c) => c.id === activeId) : undefined;

    /** 登录：加载本地会话；访客：清空 */
    useEffect(() => {
        if (!hasToken) {
            setUserId(null);
            setConversations([]);
            setActiveId(null);
            setMessages([]);
            prevActiveId.current = null;
            return;
        }
        const uid = getProfile()?.userId ?? ensureRegistered().userId;
        setUserId(uid);
        let list = loadConversations(uid);
        if (list.length === 0) {
            const c = createEmptyConversation();
            list = [c];
            saveConversations(uid, list);
        }
        setConversations(list);
        const first = list[0];
        if (first) {
            setActiveId(first.id);
            setMessages(first.messages);
            setAgentId(first.agentId);
            setIntent(first.intent);
            setTaskId(first.taskId);
            prevActiveId.current = first.id;
        }
    }, [hasToken]);

    /** 仅切换侧栏会话时同步 UI（发送消息时不要依赖 conversations 覆盖 messages） */
    useEffect(() => {
        if (!hasToken || !activeId) {
            return;
        }
        if (prevActiveId.current === activeId) {
            return;
        }
        prevActiveId.current = activeId;
        const c = conversations.find((x) => x.id === activeId);
        if (!c) {
            return;
        }
        setMessages(c.messages);
        setAgentId(c.agentId);
        setIntent(c.intent);
        setTaskId(c.taskId);
    }, [activeId, conversations, hasToken]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const persistConversations = useCallback(
        (next: Conversation[]) => {
            if (!userId) {
                return;
            }
            setConversations(next);
            saveConversations(userId, next);
        },
        [userId],
    );

    const patchActive = useCallback(
        (patch: Partial<Conversation>) => {
            if (!hasToken || !activeId) {
                return;
            }
            setConversations((prev) => {
                const next = prev.map((c) =>
                    c.id === activeId ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
                );
                if (userId) {
                    saveConversations(userId, next);
                }
                return next;
            });
        },
        [activeId, hasToken, userId],
    );

    const sendMessage = useCallback(async () => {
        const text = input.trim();
        if (!text || loading) {
            return;
        }
        setError(null);
        setInput("");
        setLoading(true);

        const sk =
            hasToken && activeId
                ? (conversations.find((c) => c.id === activeId)?.sessionKey ?? guestSessionKey)
                : guestSessionKey;
        const aid = agentId.trim() || "main";

        const userMsg: ChatMessage = { role: "user", text };
        setMessages((m) => [...m, userMsg]);

        try {
            const body: Parameters<typeof apiChat>[0] = {
                message: text,
                sessionKey: sk,
                agentId: aid,
            };
            if (intent.trim()) {
                body.intent = intent.trim();
            }
            if (taskId.trim()) {
                body.taskId = taskId.trim();
            }
            const { reply } = await apiChat(body);
            const asstMsg: ChatMessage = { role: "assistant", text: reply };

            setMessages((m) => [...m, asstMsg]);

            if (hasToken && activeId && userId) {
                setConversations((prev) => {
                    const cur = prev.find((c) => c.id === activeId);
                    if (!cur) {
                        return prev;
                    }
                    const mergedMsgs = [...cur.messages, userMsg, asstMsg];
                    let title = cur.title;
                    if (cur.messages.length === 0) {
                        title = text.length > 36 ? `${text.slice(0, 36)}…` : text;
                    }
                    const updated: Conversation = {
                        ...cur,
                        messages: mergedMsgs,
                        title,
                        agentId: aid,
                        intent: intent.trim(),
                        taskId: taskId.trim(),
                        updatedAt: new Date().toISOString(),
                    };
                    const next = prev.map((c) => (c.id === activeId ? updated : c));
                    saveConversations(userId, next);
                    return next;
                });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : "请求失败";
            setError(msg);
            setMessages((m) => [...m, { role: "assistant", text: `（错误）${msg}` }]);
        } finally {
            setLoading(false);
        }
    }, [
        activeId,
        agentId,
        conversations,
        guestSessionKey,
        hasToken,
        input,
        intent,
        loading,
        taskId,
        userId,
    ]);

    const reset = useCallback(async () => {
        setError(null);
        const aid = agentId.trim() || "main";
        try {
            if (hasToken && activeConv && activeId && userId) {
                await apiSessionReset({ sessionKey: activeConv.sessionKey, agentId: aid });
                const newKey = `u-${crypto.randomUUID()}`;
                const cleared: Conversation = {
                    ...activeConv,
                    sessionKey: newKey,
                    messages: [],
                    title: "新对话",
                    updatedAt: new Date().toISOString(),
                };
                const next = conversations.map((c) => (c.id === activeId ? cleared : c));
                persistConversations(next);
                setMessages([]);
            } else {
                await apiSessionReset({ sessionKey: guestSessionKey, agentId: aid });
                setGuestSessionKey(`guest-${crypto.randomUUID()}`);
                setMessages([]);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "重置失败");
        }
    }, [
        activeConv,
        activeId,
        agentId,
        conversations,
        guestSessionKey,
        hasToken,
        persistConversations,
        userId,
    ]);

    const selectConversation = (id: string) => {
        setActiveId(id);
        setMobileHistoryOpen(false);
    };

    const newChat = () => {
        if (!userId) {
            return;
        }
        const c = createEmptyConversation();
        const next = [c, ...conversations];
        persistConversations(next);
        setActiveId(c.id);
        prevActiveId.current = c.id;
        setMessages([]);
        setAgentId(c.agentId);
        setIntent(c.intent);
        setTaskId(c.taskId);
        setMobileHistoryOpen(false);
    };

    const sessionKeyDisplay = hasToken && activeConv ? activeConv.sessionKey : guestSessionKey;

    return (
        <div className="flex min-h-[min(70vh,640px)] flex-1 flex-col gap-3">
            {!hasToken && (
                <p className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                    <span className="text-slate-300">访客模式</span>
                    ：对话不保存到本机；重置话题后将无法查看此前内容。
                    <Link to="/login" className="ml-1 text-claw-400 underline">
                        登录
                    </Link>
                    后自动在本机注册并保存历史对话。
                </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/30 md:flex-row">
                {hasToken && (
                    <ChatSidebar
                        conversations={conversations}
                        activeId={activeId}
                        onSelect={selectConversation}
                        onNewChat={newChat}
                        mobileOpen={mobileHistoryOpen}
                        onCloseMobile={() => setMobileHistoryOpen(false)}
                    />
                )}

                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2 border-b border-slate-800/80 px-3 py-2 md:hidden">
                        {hasToken && (
                            <Button
                                type="button"
                                variant="secondary"
                                className="shrink-0 px-3"
                                onClick={() => setMobileHistoryOpen(true)}
                            >
                                历史
                            </Button>
                        )}
                        <span className="truncate text-xs text-slate-500">
                            {hasToken ? "已登录 · 历史已保存" : "访客 · 不保存历史"}
                        </span>
                    </div>

                    <details className="border-b border-slate-800/80 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-400">
                            会话参数（sessionKey / agent / intent / task）
                        </summary>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="block text-[11px] text-slate-500">
                                sessionKey（当前）
                                <Input className="mt-1 font-mono text-xs" value={sessionKeyDisplay} readOnly />
                            </label>
                            <label className="block text-[11px] text-slate-400">
                                agentId
                                <Input
                                    className="mt-1"
                                    value={agentId}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setAgentId(v);
                                        if (hasToken && activeId) {
                                            patchActive({ agentId: v });
                                        }
                                    }}
                                    placeholder="main"
                                />
                            </label>
                            <label className="block text-[11px] text-slate-400">
                                intent（可选）
                                <Input
                                    className="mt-1"
                                    value={intent}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setIntent(v);
                                        if (hasToken && activeId) {
                                            patchActive({ intent: v });
                                        }
                                    }}
                                />
                            </label>
                            <label className="block text-[11px] text-slate-400">
                                taskId（可选）
                                <Input
                                    className="mt-1"
                                    value={taskId}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setTaskId(v);
                                        if (hasToken && activeId) {
                                            patchActive({ taskId: v });
                                        }
                                    }}
                                />
                            </label>
                        </div>
                        <div className="mt-2">
                            <Button type="button" variant="secondary" onClick={() => void reset()}>
                                重置话题
                            </Button>
                            <p className="mt-2 text-[11px] text-slate-500">
                                访客：重置后当前窗口清空，无历史。登录用户：重置后清空当前对话，侧栏仍保留该会话条目。
                            </p>
                        </div>
                    </details>

                    <Card className="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none">
                        <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                            {messages.length === 0 && (
                                <p className="text-center text-sm text-slate-500">
                                    {hasToken
                                        ? "从左侧选择历史对话，或新建对话。"
                                        : "发送消息开始对话。"}
                                </p>
                            )}
                            {messages.map((m, i) => (
                                <div
                                    key={`${i}-${m.role}-${m.text.slice(0, 16)}`}
                                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                                >
                                    <div
                                        className={`max-w-[92%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[85%] ${
                                            m.role === "user"
                                                ? "bg-claw-600/90 text-white shadow-lg"
                                                : "border border-slate-700/80 bg-slate-800/80 text-slate-100"
                                        }`}
                                    >
                                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                                    </div>
                                </div>
                            ))}
                            {loading && (
                                <div className="flex justify-start">
                                    <div className="rounded-2xl border border-slate-700/80 bg-slate-800/60 px-4 py-3 text-sm text-slate-400">
                                        正在思考…
                                    </div>
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>
                        {error && (
                            <div className="border-t border-slate-800 px-3 py-2 text-xs text-rose-400 sm:px-4">
                                <p>{error}</p>
                                {(error.includes("token") || error.includes("Token")) && (
                                    <p className="mt-1">
                                        <Link to="/login" className="text-claw-400 underline">
                                            前往登录
                                        </Link>
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="border-t border-slate-800/90 bg-slate-900/40 p-3">
                            <TextArea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
                                rows={3}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void sendMessage();
                                    }
                                }}
                                className="resize-none"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                                <Button type="button" onClick={() => void sendMessage()} disabled={loading}>
                                    发送
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
