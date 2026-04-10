import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ChatMessage, Conversation } from "@/chat/types";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/locale/LocaleContext";
import {
    apiChat,
    apiListTasks,
    apiSessionReset,
    apiWorkspaceAgentsGet,
    apiWorkspaceSessionDelete,
} from "@/api/client";
import { ChatSidebar } from "@/components/ChatSidebar";
import { Button, Card, Input, Select, TextArea } from "@/components/ui";
import { createEmptyConversation, loadConversations, saveConversations } from "@/lib/conversationStore";
import { ensureRegistered, getProfile } from "@/lib/localUser";

export function ChatPage() {
    const { hasToken } = useAuth();
    const { t } = useLocale();

    const [guestSessionKey, setGuestSessionKey] = useState(() => `guest-${crypto.randomUUID()}`);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const [agentId, setAgentId] = useState("main");
    const [intent, setIntent] = useState("");
    const [taskId, setTaskId] = useState("");
    const [agentLocked, setAgentLocked] = useState(false);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
    const [agentOptions, setAgentOptions] = useState<{ id: string; label: string }[]>([]);
    const [recentTasks, setRecentTasks] = useState<{ taskId: string; title: string }[]>([]);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevActiveId = useRef<string | null>(null);

    const activeConv = activeId ? conversations.find((c) => c.id === activeId) : undefined;

    useEffect(() => {
        if (!hasToken) {
            setAgentOptions(fallbackAgentOptions());
            setRecentTasks([]);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const ag = await apiWorkspaceAgentsGet();
                const reg = ag.registry as { agents?: { id: string; displayName?: string }[] } | undefined;
                const list = Array.isArray(reg?.agents)
                    ? reg.agents.map((a) => ({
                          id: a.id,
                          label: a.displayName?.trim() ? `${a.id} — ${a.displayName}` : a.id,
                      }))
                    : [];
                if (!cancelled) setAgentOptions(list.length > 0 ? list : fallbackAgentOptions());
            } catch {
                if (!cancelled) setAgentOptions(fallbackAgentOptions());
            }
            try {
                const { tasks } = await apiListTasks({ limit: 40 });
                if (!cancelled) {
                    setRecentTasks(tasks.map((x) => ({ taskId: x.taskId, title: x.title })));
                }
            } catch {
                if (!cancelled) setRecentTasks([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [hasToken]);

    function fallbackAgentOptions(): { id: string; label: string }[] {
        return [
            { id: "main", label: "main" },
            { id: "daily_report", label: "daily_report" },
            { id: "code_review", label: "code_review" },
        ];
    }

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
            const c = createEmptyConversation(t("chat.newChat"));
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
            setAgentLocked(Boolean(first.agentLocked));
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
        setAgentLocked(Boolean(c.agentLocked));
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
            if (taskId.trim() && agentLocked) {
                body.agentLocked = true;
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
                        agentLocked,
                        updatedAt: new Date().toISOString(),
                    };
                    const next = prev.map((c) => (c.id === activeId ? updated : c));
                    saveConversations(userId, next);
                    return next;
                });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : t("chat.errorToken");
            setError(msg);
            setMessages((m) => [...m, { role: "assistant", text: `${t("chat.errorPrefix")}${msg}` }]);
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
        t,
        taskId,
        agentLocked,
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
                    title: t("chat.newChat"),
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
            setError(e instanceof Error ? e.message : t("chat.resetFail"));
        }
    }, [
        activeConv,
        activeId,
        agentId,
        conversations,
        guestSessionKey,
        hasToken,
        persistConversations,
        t,
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
        const c = createEmptyConversation(t("chat.newChat"));
        const next = [c, ...conversations];
        persistConversations(next);
        setActiveId(c.id);
        prevActiveId.current = c.id;
        setMessages([]);
        setAgentId(c.agentId);
        setIntent(c.intent);
        setTaskId(c.taskId);
        setAgentLocked(Boolean(c.agentLocked));
        setMobileHistoryOpen(false);
    };

    const deleteConversation = useCallback(
        async (id: string) => {
            if (!hasToken || !userId) {
                return;
            }
            if (!window.confirm(t("chat.confirmDeleteChat"))) {
                return;
            }
            const c = conversations.find((x) => x.id === id);
            if (!c) {
                return;
            }
            try {
                await apiWorkspaceSessionDelete({
                    sessionKey: c.sessionKey,
                    agentId: c.agentId?.trim() || "main",
                });
            } catch (e) {
                setError(e instanceof Error ? e.message : t("chat.errorToken"));
            }
            const next = conversations.filter((x) => x.id !== id);
            persistConversations(next);
            if (activeId === id) {
                const first = next[0];
                if (first) {
                    setActiveId(first.id);
                    setMessages(first.messages);
                    setAgentId(first.agentId);
                    setIntent(first.intent);
                    setTaskId(first.taskId);
                    setAgentLocked(Boolean(first.agentLocked));
                    prevActiveId.current = first.id;
                } else {
                    const empty = createEmptyConversation(t("chat.newChat"));
                    persistConversations([empty]);
                    setActiveId(empty.id);
                    setMessages([]);
                    setAgentId(empty.agentId);
                    setIntent(empty.intent);
                    setTaskId(empty.taskId);
                    setAgentLocked(Boolean(empty.agentLocked));
                    prevActiveId.current = empty.id;
                }
            }
        },
        [activeId, conversations, hasToken, persistConversations, t, userId],
    );

    const sessionKeyDisplay = hasToken && activeConv ? activeConv.sessionKey : guestSessionKey;

    const agentIdTrim = agentId.trim();
    const agentInList = agentOptions.some((a) => a.id === agentIdTrim);
    const agentSelectValue = agentInList ? agentIdTrim : "__custom__";

    const taskIdTrim = taskId.trim();
    const taskInRecent = recentTasks.some((x) => x.taskId === taskIdTrim);
    const taskSelectValue = !taskIdTrim ? "none" : taskInRecent ? taskIdTrim : "__custom__";

    const patchAgent = (v: string) => {
        setAgentId(v);
        if (hasToken && activeId) {
            patchActive({ agentId: v });
        }
    };
    const patchIntent = (v: string) => {
        setIntent(v);
        if (hasToken && activeId) {
            patchActive({ intent: v });
        }
    };
    const patchTask = (v: string) => {
        const nextLocked = v.trim() ? agentLocked : false;
        setTaskId(v);
        if (!v.trim()) {
            setAgentLocked(false);
        }
        if (hasToken && activeId) {
            patchActive({ taskId: v, agentLocked: nextLocked });
        }
    };

    const patchAgentLocked = (v: boolean) => {
        setAgentLocked(v);
        if (hasToken && activeId) {
            patchActive({ agentLocked: v });
        }
    };

    return (
        <div className="flex min-h-[min(70vh,640px)] flex-1 flex-col gap-3">
            {!hasToken && (
                <p className="rounded-xl border border-slate-200/90 bg-white/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                    <span className="text-slate-800 dark:text-slate-300">{t("chat.guestMode")}</span>
                    {t("chat.guestIntro")}
                    <Link to="/login" className="mx-1 text-claw-400 underline">
                        {t("layout.login")}
                    </Link>
                    {t("chat.guestOutro")}
                </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/50 md:flex-row dark:border-slate-800/80 dark:bg-slate-900/30">
                {hasToken && (
                    <ChatSidebar
                        conversations={conversations}
                        activeId={activeId}
                        onSelect={selectConversation}
                        onNewChat={newChat}
                        onDelete={deleteConversation}
                        mobileOpen={mobileHistoryOpen}
                        onCloseMobile={() => setMobileHistoryOpen(false)}
                    />
                )}

                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2 border-b border-slate-200/90 px-3 py-2 dark:border-slate-800/80 md:hidden">
                        {hasToken && (
                            <Button
                                type="button"
                                variant="secondary"
                                className="shrink-0 px-3"
                                onClick={() => setMobileHistoryOpen(true)}
                            >
                                {t("chat.history")}
                            </Button>
                        )}
                        <span className="truncate text-xs text-slate-500 dark:text-slate-500">
                            {hasToken ? t("chat.statusSaved") : t("chat.statusGuest")}
                        </span>
                    </div>

                    <details className="border-b border-slate-200/90 px-3 py-2 dark:border-slate-800/80">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-400">
                            {t("chat.sessionParams")}
                        </summary>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="block text-[11px] text-slate-600 dark:text-slate-500">
                                {t("chat.sessionKey")}
                                <Input className="mt-1 font-mono text-xs" value={sessionKeyDisplay} readOnly />
                            </label>
                            <label className="block text-[11px] text-slate-600 dark:text-slate-400">
                                {t("chat.agentIdLabel")}
                                <Select
                                    className="mt-1"
                                    value={agentSelectValue}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        if (v === "__custom__") {
                                            patchAgent(agentInList ? "" : agentId);
                                        } else {
                                            patchAgent(v);
                                        }
                                    }}
                                >
                                    {agentOptions.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.label}
                                        </option>
                                    ))}
                                    <option value="__custom__">{t("chat.agentCustom")}</option>
                                </Select>
                                {agentSelectValue === "__custom__" && (
                                    <Input
                                        className="mt-1"
                                        value={agentId}
                                        onChange={(e) => patchAgent(e.target.value)}
                                        placeholder="main"
                                    />
                                )}
                            </label>
                            <label className="block text-[11px] text-slate-600 dark:text-slate-400">
                                {t("chat.intentOpt")}
                                <Select
                                    className="mt-1"
                                    value={intent.trim() || ""}
                                    onChange={(e) => patchIntent(e.target.value)}
                                >
                                    <option value="">{t("chat.intentNone")}</option>
                                    <option value="chat">chat</option>
                                    <option value="daily_report">daily_report</option>
                                    <option value="code_review">code_review</option>
                                </Select>
                            </label>
                            <label className="block text-[11px] text-slate-600 dark:text-slate-400 sm:col-span-2">
                                {t("chat.taskIdOpt")}
                                <Select
                                    className="mt-1 font-mono text-xs"
                                    value={taskSelectValue}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        if (v === "none") {
                                            patchTask("");
                                        } else if (v === "__custom__") {
                                            patchTask(taskInRecent ? "" : taskId);
                                        } else {
                                            patchTask(v);
                                        }
                                    }}
                                >
                                    <option value="none">{t("chat.taskIdNone")}</option>
                                    {recentTasks.map((x) => (
                                        <option key={x.taskId} value={x.taskId}>
                                            {(x.title || x.taskId).length > 36
                                                ? `${(x.title || x.taskId).slice(0, 36)}…`
                                                : x.title || x.taskId}{" "}
                                            · {x.taskId.length > 20 ? `${x.taskId.slice(0, 12)}…` : x.taskId}
                                        </option>
                                    ))}
                                    <option value="__custom__">{t("chat.taskIdManual")}</option>
                                </Select>
                                {taskSelectValue === "__custom__" && (
                                    <Input
                                        className="mt-1 font-mono text-xs"
                                        value={taskId}
                                        onChange={(e) => patchTask(e.target.value)}
                                        placeholder="task-…"
                                    />
                                )}
                            </label>
                            <label className="block text-[11px] text-slate-600 dark:text-slate-400 sm:col-span-2">
                                <span
                                    className={`flex cursor-pointer items-start gap-2 ${!taskIdTrim ? "opacity-50" : ""}`}
                                >
                                    <input
                                        type="checkbox"
                                        className="mt-0.5"
                                        checked={agentLocked}
                                        disabled={!taskIdTrim}
                                        onChange={(e) => patchAgentLocked(e.target.checked)}
                                    />
                                    <span>{t("chat.agentLocked")}</span>
                                </span>
                                <p className="mt-1 pl-6 text-slate-500 dark:text-slate-500">{t("chat.agentLockedHint")}</p>
                            </label>
                        </div>
                        <div className="mt-2">
                            <Button type="button" variant="secondary" onClick={() => void reset()}>
                                {t("chat.resetTopic")}
                            </Button>
                            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-500">
                                {t("chat.resetHint")}
                            </p>
                        </div>
                    </details>

                    <Card className="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none">
                        <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                            {messages.length === 0 && (
                                <p className="text-center text-sm text-slate-500 dark:text-slate-500">
                                    {hasToken ? t("chat.emptyLoggedIn") : t("chat.emptyGuest")}
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
                                                ? "bg-claw-600 text-white shadow-md dark:bg-claw-600/90 dark:shadow-lg"
                                                : "border border-slate-200 bg-white text-slate-800 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-100"
                                        }`}
                                    >
                                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                                    </div>
                                </div>
                            ))}
                            {loading && (
                                <div className="flex justify-start">
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700/80 dark:bg-slate-800/60 dark:text-slate-400">
                                        {t("chat.thinking")}
                                    </div>
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>
                        {error && (
                            <div className="border-t border-slate-200 px-3 py-2 text-xs text-rose-600 dark:border-slate-800 dark:text-rose-400 sm:px-4">
                                <p>{error}</p>
                                {(error.includes("token") || error.includes("Token")) && (
                                    <p className="mt-1">
                                        <Link to="/login" className="text-claw-600 underline dark:text-claw-400">
                                            {t("chat.goLogin")}
                                        </Link>
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="border-t border-slate-200/90 bg-slate-50/90 p-3 dark:border-slate-800/90 dark:bg-slate-900/40">
                            <TextArea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={t("chat.placeholder")}
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
                                    {t("chat.send")}
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
