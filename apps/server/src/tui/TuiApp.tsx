import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import WebSocket from "ws";
import { appConfig } from "@/config/evn";
import {
    filterSlashCommands,
    isSlashMenuLine,
    uniqueSlashLabels,
    type SlashCommandEntry,
} from "@/cli/slashCommands";
import { runTerminalSlash } from "@/cli/terminalCommandRunner";
import * as T from "@/tui/tuiStrings";

export type TuiAppProps = {
    wsUrl: string;
    defaultSession: string;
    agentId?: string;
    taskId?: string;
};

type ChatRow = { id: number; role: "user" | "assistant" | "system"; text: string };

const MAX_MENU_ROWS = 10;

/** Claude Code 风格：橙主色 + 选中行青/浅蓝（需终端支持 truecolor，否则近似降级） */
const THEME = {
    orange: "#D77757",
    orangeBright: "#ffa94d",
    orangeMuted: "#c9782a",
    menuSelect: "#eeeeee",
    white: "#f5f5f4",
    gray: "#eeeeee",
    grayDim: "#ffffff",
    warn: "#fbbf24",
} as const;

function truncateMiddle(s: string, max: number): string {
    if (s.length <= max) return s;
    const keep = Math.max(8, max - 3);
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

function wrapText(text: string, width: number): string[] {
    const w = Math.max(16, width);
    const t = text.replace(/\r\n/g, "\n");
    const out: string[] = [];
    for (const para of t.split("\n")) {
        let s = para;
        while (s.length > w) {
            out.push(s.slice(0, w));
            s = s.slice(w);
        }
        out.push(s);
    }
    return out.length ? out : [""];
}

function dimRule(width: number): string {
    const n = Math.max(8, Math.min(width - 2, 96));
    return `╴${"─".repeat(n - 2)}╶`;
}

/** 浅色分隔线（输入区上方，对齐参考图里的 white divider） */
function inputDivider(width: number): string {
    const n = Math.max(12, Math.min(width - 2, 100));
    return "─".repeat(n);
}

function fitDesc(desc: string, max: number): string {
    if (desc.length <= max) return desc;
    if (max <= 1) return "…";
    return `${desc.slice(0, max - 1)}…`;
}

type MessageBlockProps = {
    row: ChatRow;
    wrapW: number;
};

/** 顶栏机器人头像（方块像素风） */
const PIXEL_LOGO: readonly string[] = [" ▄████▄ ", "██ ██ ██", "████████", " █ ██ █ "];

function PixelLogo(): React.ReactElement {
    return (
        <Box flexDirection="column" marginRight={2} marginBottom={0} justifyContent="center">
            {PIXEL_LOGO.map((line, i) => (
                <Text key={i} color={THEME.orange}>
                    {line}
                </Text>
            ))}
        </Box>
    );
}

const MessageBlock = memo(function MessageBlockInner({
    row,
    wrapW,
}: MessageBlockProps): React.ReactElement {
    const indent = "  ";
    const contIndent = "    ";
    const contentW = Math.max(8, wrapW);

    if (row.role === "user") {
        const lines = wrapText(row.text, contentW);
        return (
            <Box flexDirection="column" marginBottom={0.5} marginTop={0.5}>
                {lines.map((line, j) => (
                    <Text key={j}>
                        {j === 0 ? (
                            <>
                                <Text color={THEME.orangeBright} bold>
                                    {"> "}
                                </Text>
                                <Text color={THEME.white}>{line}</Text>
                            </>
                        ) : (
                            <>
                                <Text color={THEME.grayDim}>{indent}</Text>
                                <Text color={THEME.white}>{line}</Text>
                            </>
                        )}
                    </Text>
                ))}
            </Box>
        );
    }

    if (row.role === "assistant") {
        const lines = wrapText(row.text, contentW);
        return (
            <Box flexDirection="column" marginBottom={0.5} marginTop={0.5}>
                {lines.map((line, j) => (
                    <Text key={j}>
                        {j === 0 ? (
                            <>
                                <Text color={THEME.white}  bold>
                                    {"● "}
                                </Text>
                                <Text color={THEME.white}>{line}</Text>
                            </>
                        ) : (
                            <>
                                <Text color={THEME.grayDim}>{contIndent}</Text>
                                <Text color={THEME.white}>{line}</Text>
                            </>
                        )}
                    </Text>
                ))}
            </Box>
        );
    }

    const lines = wrapText(row.text, contentW);
    return (
        <Box flexDirection="column" marginBottom={0.5} marginTop={0.5} >
            {lines.map((line, j) => (
                <Text key={j} >
                    {j === 0 ? (
                        <>
                            <Text color={THEME.warn} bold>
                                {"! "}
                            </Text>
                            <Text color={THEME.warn}>{line}</Text>
                        </>
                    ) : (
                        <>
                            <Text color={THEME.grayDim}>{contIndent}</Text>
                            <Text color={THEME.warn}>{line}</Text>
                        </>
                    )}
                </Text>
            ))}
        </Box>
    );
});

function StatusStrip(props: { cols: number; parts: string[] }): React.ReactElement {
    const sep = "  ·  ";
    const maxInner = Math.max(12, props.cols - 2);
    let core = props.parts.join(sep);
    if (core.length > maxInner) {
        core = truncateMiddle(core, maxInner);
    }
    const padded = ` ${core} `.padEnd(props.cols, " ");
    return (
        <Box flexDirection="column" width={props.cols}>
            <Text backgroundColor="black" color={THEME.orangeBright} bold={false}>
                {padded}
            </Text>
        </Box>
    );
}

type SlashMenuProps = {
    entries: SlashCommandEntry[];
    selectedIndex: number;
    cols: number;
    locale: import("@/config/evn").UiLocale;
};

const SlashMenu = memo(function SlashMenuInner({
    entries,
    selectedIndex,
    cols,
    locale,
}: SlashMenuProps): React.ReactElement {
    const visible = entries.slice(0, MAX_MENU_ROWS);
    const more = entries.length > MAX_MENU_ROWS;
    const cmdW = Math.min(
        22,
        Math.max(10, ...visible.map((e) => e.cmd.length)) + 1
    );
    const descMax = Math.max(12, cols - cmdW - 6);

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={THEME.orange}
            borderDimColor={false}
            paddingX={1}
            paddingY={1}
            marginTop={1}
        >
            <Text color={THEME.orangeMuted}>{T.slashMenuBar(locale)}</Text>
            {visible.map((e, i) => {
                const active = i === selectedIndex;
                const desc = fitDesc(e.desc, descMax);
                const gap = Math.max(1, cmdW - e.cmd.length);
                return (
                    <Box
                        key={e.cmd}
                        flexDirection="row"
                        marginBottom={i < visible.length - 1 ? 1 : 0}
                    >
                        <Text
                            color={active ? THEME.orangeBright : undefined}
                            dimColor={!active}
                            bold={active}
                        >
                            {active ? "› " : "  "}
                        </Text>
                        <Text
                            color={active ? THEME.menuSelect : THEME.white}
                            bold={active}
                            dimColor={!active}
                        >
                            {e.cmd}
                        </Text>
                        <Text color={THEME.grayDim}>{" ".repeat(gap)} </Text>
                        <Text color={active ? THEME.gray : THEME.grayDim}>{desc}</Text>
                    </Box>
                );
            })}
            {more ? (
                <Text color={THEME.orangeMuted}>
                    {T.slashMenuMore(locale, entries.length - MAX_MENU_ROWS)}
                </Text>
            ) : null}
        </Box>
    );
});

export function TuiApp({ wsUrl, defaultSession, agentId, taskId }: TuiAppProps): React.ReactElement {
    const locale = appConfig.uiLocale;
    const { exit } = useApp();
    const { stdout } = useStdout();
    const cols = stdout?.columns ?? 80;

    const [lines, setLines] = useState<ChatRow[]>([]);
    const [input, setInput] = useState("");
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState(() =>
        locale === "en" ? "connecting..." : "connecting…",
    );
    const [model, setModel] = useState("");
    const [appVersion, setAppVersion] = useState("");
    const [sessionKey, setSessionKey] = useState(defaultSession);
    const [busy, setBusy] = useState(false);
    const [busyUi, setBusyUi] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);
    const wsRef = useRef<WebSocket | null>(null);
    const requestSeqRef = useRef(1);
    /** 按 requestId 跟踪，避免客户端提前重置与服务端队列不一致导致错位 */
    const pendingByIdRef = useRef<Map<string, { gotAssistant: boolean; gotError: boolean }>>(
        new Map()
    );
    const inputRef = useRef(input);
    const slashIndexRef = useRef(slashIndex);
    const nextLineIdRef = useRef(1);

    inputRef.current = input;
    slashIndexRef.current = slashIndex;

    const appendLine = useCallback((row: Omit<ChatRow, "id">): void => {
        const id = nextLineIdRef.current++;
        setLines((prev) => [...prev, { id, ...row }]);
    }, []);

    const filteredSlash = useMemo(
        () => uniqueSlashLabels(filterSlashCommands(input, locale)),
        [input, locale],
    );
    const menuVisible = isSlashMenuLine(input) && filteredSlash.length > 0;

    useEffect(() => {
        const timer = setTimeout(() => setBusyUi(busy), busy ? 120 : 220);
        return () => clearTimeout(timer);
    }, [busy]);

    useEffect(() => {
        setSlashIndex((i) => {
            if (filteredSlash.length === 0) return 0;
            return Math.min(i, filteredSlash.length - 1);
        });
    }, [filteredSlash]);

    useInput((ch, key) => {
        if (key.ctrl && ch === "c") {
            exit();
            return;
        }
        if (!isSlashMenuLine(inputRef.current)) {
            return;
        }
        const list = uniqueSlashLabels(filterSlashCommands(inputRef.current, locale));
        if (list.length === 0) return;

        if (key.upArrow) {
            setSlashIndex((i) => (i - 1 + list.length) % list.length);
            return;
        }
        if (key.downArrow) {
            setSlashIndex((i) => (i + 1) % list.length);
            return;
        }
        if (key.tab) {
            const idx = Math.min(slashIndexRef.current, list.length - 1);
            const sel = list[idx] ?? list[0];
            if (sel) setInput(sel.cmd);
            return;
        }
        if (key.escape) {
            setInput("");
            setSlashIndex(0);
        }
    });

    useEffect(() => {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.on("open", () => {
            setConnected(true);
            setStatus(locale === "en" ? "connected" : "connected");
        });
        ws.on("close", () => {
            setConnected(false);
            setStatus(locale === "en" ? "disconnected" : "disconnected");
            setBusy(false);
            pendingByIdRef.current.clear();
            wsRef.current = null;
        });
        ws.on("error", () => {
            setStatus(locale === "en" ? "error" : "error");
            setBusy(false);
            pendingByIdRef.current.clear();
        });
        ws.on("message", (buf) => {
            try {
                const msg = JSON.parse(String(buf)) as {
                    type?: string;
                    requestId?: string;
                    version?: string;
                    model?: string;
                    text?: string;
                    message?: string;
                };
                if (msg.type === "ready") {
                    setModel(String(msg.model ?? ""));
                    setAppVersion(String(msg.version ?? ""));
                    return;
                }
                if (msg.type === "assistant") {
                    const rid = msg.requestId;
                    if (rid && pendingByIdRef.current.has(rid)) {
                        const st = pendingByIdRef.current.get(rid);
                        if (st) st.gotAssistant = true;
                    }
                    appendLine({ role: "assistant", text: String(msg.text ?? "") });
                    return;
                }
                if (msg.type === "started") {
                    setBusy(true);
                    if (msg.requestId) {
                        if (!pendingByIdRef.current.has(msg.requestId)) {
                            pendingByIdRef.current.set(msg.requestId, {
                                gotAssistant: false,
                                gotError: false,
                            });
                        }
                    }
                    return;
                }
                if (msg.type === "done") {
                    const rid = msg.requestId;
                    if (rid) {
                        const pending = pendingByIdRef.current.get(rid);
                        if (pending && !pending.gotAssistant && !pending.gotError) {
                            appendLine({
                                role: "system",
                                text: T.errDoneNoContent(locale),
                            });
                        }
                        pendingByIdRef.current.delete(rid);
                    }
                    setBusy(pendingByIdRef.current.size > 0);
                    return;
                }
                if (msg.type === "error") {
                    const rid = msg.requestId;
                    if (rid) {
                        const st = pendingByIdRef.current.get(rid);
                        if (st) st.gotError = true;
                    }
                    const raw = String(msg.message ?? "");
                    const message =
                        raw === "This operation was aborted" ? T.errAborted(locale) : raw;
                    appendLine({ role: "system", text: `${T.errPrefix(locale)}${message}` });
                }
            } catch {
                /* ignore */
            }
        });
        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [appendLine, locale, wsUrl]);

    const runLocalSlash = useCallback(
        async (fullLine: string): Promise<boolean> => {
            const text = fullLine.trim();
            if (text === "/exit" || text === "/quit") {
                exit();
                return true;
            }
            if (text === "/help" || text === "/?") {
                appendLine({
                    role: "system",
                    text: T.tuiHelpLines(locale, { sessionKey, taskId }),
                });
                return true;
            }
            if (text === "/clear") {
                setLines([]);
                return true;
            }
            if (text === "/status") {
                appendLine({
                    role: "system",
                    text: T.tuiStatusLines(locale, { sessionKey, agentId, taskId }),
                });
                return true;
            }
            if (text === "/workspace") {
                appendLine({
                    role: "system",
                    text: T.tuiWorkspaceLines(locale),
                });
                return true;
            }
            if (text.startsWith("/session")) {
                const rest = text.slice("/session".length).trim();
                if (!rest) {
                    appendLine({ role: "system", text: T.usageSession(locale) });
                    return true;
                }
                setSessionKey(rest);
                appendLine({
                    role: "system",
                    text: T.sessionSwitched(locale, rest, taskId),
                });
                return true;
            }
            if (text.startsWith("/")) {
                const out = await runTerminalSlash(text);
                if (out !== null) {
                    appendLine({ role: "system", text: out });
                    return true;
                }
                appendLine({ role: "system", text: T.unknownCommand(locale) });
                return true;
            }
            return false;
        },
        [agentId, appendLine, exit, locale, sessionKey, taskId]
    );

    const submit = useCallback(
        async (value: string) => {
            const v = value.trim();
            if (!v) return;

            // 普通问答走快速路径：先上屏用户消息，再发 ws，减少回车后的可感知延迟。
            if (!v.startsWith("/")) {
                setInput("");
                const ws = wsRef.current;
                if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
                    appendLine({ role: "system", text: T.errNotConnected(locale) });
                    return;
                }
                appendLine({ role: "user", text: v });
                setBusy(true);
                const requestId = `req-${requestSeqRef.current++}`;
                pendingByIdRef.current.set(requestId, { gotAssistant: false, gotError: false });
                ws.send(
                    JSON.stringify({
                        type: "chat",
                        requestId,
                        text: v,
                        sessionKey,
                        ...(agentId ? { agentId } : {}),
                        ...(taskId ? { taskId } : {}),
                    })
                );
                return;
            }

            if (v.startsWith("/") && !v.includes(" ")) {
                const list = uniqueSlashLabels(filterSlashCommands(v, locale));
                if (list.length > 0) {
                    const idx = Math.min(slashIndex, Math.max(0, list.length - 1));
                    const sel = list[idx] ?? list[0];
                    if (sel && v !== sel.cmd) {
                        setInput(sel.cmd);
                        return;
                    }
                    if (sel && v === sel.cmd) {
                        if (sel.needsArg) {
                            appendLine({
                                role: "system",
                                text:
                                    sel.cmd === "/session"
                                        ? T.needsArgSession(locale)
                                        : T.needsArgGeneric(locale),
                            });
                            return;
                        }
                        setInput("");
                        await runLocalSlash(sel.cmd);
                        return;
                    }
                }
            }

            if (await runLocalSlash(v)) {
                setInput("");
                return;
            }

            setInput("");
            const ws = wsRef.current;
            if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
                appendLine({ role: "system", text: T.errNotConnected(locale) });
                return;
            }
            appendLine({ role: "user", text: v });
            setBusy(true);
            const requestId = `req-${requestSeqRef.current++}`;
            ws.send(
                JSON.stringify({
                    type: "chat",
                    requestId,
                    text: v,
                    sessionKey,
                    ...(agentId ? { agentId } : {}),
                    ...(taskId ? { taskId } : {}),
                })
            );
        },
        [agentId, appendLine, connected, locale, runLocalSlash, sessionKey, slashIndex, taskId]
    );

    /** 斜杠菜单占位；不截断聊天记录，由终端缓冲区纵向滚动（瀑布流） */
    const menuReserveLines = menuVisible ? 13 : 1;
    const urlLine = truncateMiddle(wsUrl, Math.max(20, cols - 8));
    /** 与聊天区内边距一致：左右各 1 列 */
    const barCols = Math.max(24, cols - 2);
    /** `>` 之后可用的正文列宽 */
    const textCols = Math.max(16, barCols - 2);

    const metaBits = [
        connected ? T.metaReady(locale) : T.wsStatusLabel(locale, status),
        model || null,
        busyUi ? T.metaStreaming(locale) : T.metaIdle(locale),
        T.metaCtrlC(locale),
    ].filter(Boolean) as string[];

    return (
        <Box flexDirection="column" width={cols}>
            <Box
                flexDirection="column"
                paddingX={1}
                paddingTop={1}
                paddingBottom={2}
                borderStyle="double"
                borderColor={THEME.orange}
                borderDimColor={false}
                flexShrink={0}
            >
                <Box flexDirection="row" alignItems="flex-start">
                    <PixelLogo />
                    <Box flexDirection="column" flexGrow={1}>
                        <Box
                            flexDirection="row"
                            justifyContent="space-between"
                            alignItems="flex-start"
                        >
                            <Box flexDirection="column" marginBottom={1}>
                                <Text>
                                    <Text bold color={THEME.white}>
                                        One
                                    </Text>
                                    <Text bold color={THEME.orangeBright}>
                                        Claw
                                    </Text>
                                    <Text color={THEME.grayDim}> workspace</Text>
                                    {appVersion ? (
                                        <Text color={THEME.orangeMuted}>
                                            {"  "}
                                            v{appVersion}
                                        </Text>
                                    ) : null}
                                </Text>
                                <Text color={THEME.orangeMuted}>{T.tuiWelcomeSubtitle(locale)}</Text>
                            </Box>
                            <Box flexDirection="column" alignItems="flex-end">
                                <Text>
                                    <Text color={THEME.orangeMuted}>{T.tuiSessionLabel(locale)}</Text>
                                    <Text> </Text>
                                    <Text color={THEME.white} bold>
                                        {sessionKey}
                                    </Text>
                                </Text>
                                <Text color={THEME.grayDim}>{T.tuiTipsSlash(locale)}</Text>
                            </Box>
                        </Box>
                        <Text color={THEME.gray} wrap="truncate-end">
                            {urlLine}
                        </Text>
                    </Box>
                </Box>
                <Text color={THEME.orangeMuted}>{dimRule(cols)}</Text>
            </Box>

            <Box flexDirection="column" marginTop={1} marginBottom={0} paddingX={1} paddingY={0}>
                {lines.length === 0 && !busy ? (
                    <Box flexDirection="column" marginBottom={2}>
                        <Text color={THEME.gray}>{T.tuiEmptyHint(locale)}</Text>
                        <Box marginTop={1}>
                            <Text color={THEME.grayDim}>
                                {T.tuiSlashOpenLine(locale).before}
                                <Text color={THEME.orangeBright} bold>/</Text>
                                {T.tuiSlashOpenLine(locale).after}
                            </Text>
                        </Box>
                    </Box>
                ) : (
                    <>
                        {lines.map((row) => (
                            <MessageBlock key={row.id} row={row} wrapW={textCols} />
                        ))}
                        {/* 与 MessageBlock 上下 margin 对齐，避免第二轮紧贴问题 */}
                        {busy ? (
                            <Box flexDirection="column" marginTop={0.5} marginBottom={0.5}>
                                <Text>
                                    <Text color={THEME.white} bold>
                                        {"● "}
                                    </Text>
                                    <Text color={THEME.gray}>{T.tuiGenerating(locale)}</Text>
                                </Text>
                            </Box>
                        ) : null}
                    </>
                )}
            </Box>

            <Box
                height={menuReserveLines}
                flexShrink={0}
                marginTop={0}
                overflowY="hidden"
            >
                {menuVisible ? (
                    <SlashMenu
                        entries={filteredSlash}
                        selectedIndex={slashIndex}
                        cols={Math.max(40, cols - 2)}
                        locale={locale}
                    />
                ) : (
                    <Text color={THEME.grayDim}> </Text>
                )}
            </Box>

            <Box
                flexDirection="column"
                paddingX={1}
                marginTop={0.5}
                marginBottom={0.5}
                minHeight={6}
                flexShrink={0}
            >
                <Text dimColor color={THEME.white}>
                    {inputDivider(barCols)}
                </Text>
                <Text color={THEME.gray}>{T.tuiInputFooter(locale)}</Text>
                <Box
                    flexDirection="row"
                    alignItems="center"
                    paddingX={0}
                    paddingY={0}
                    borderStyle="single"
                    borderColor={connected ? THEME.orangeBright : THEME.warn}
                    borderDimColor={false}
                    minHeight={3}
                >
                    <Text bold color={THEME.white}>
                        {"> "}
                    </Text>
                    <Box flexGrow={1}>
                        <TextInput
                            value={input}
                            onChange={setInput}
                            onSubmit={submit}
                            placeholder={T.tuiPlaceholder(locale)}
                            showCursor={true}
                        />
                    </Box>
                </Box>
            </Box>

            <Box marginTop={0.5} flexDirection="column" flexShrink={0}>
                <StatusStrip cols={cols} parts={metaBits} />
                <Text color={THEME.grayDim}> {T.tuiBottomHint(locale)}</Text>
            </Box>
        </Box>
    );
}
