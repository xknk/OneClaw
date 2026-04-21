import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import WebSocket from "ws";
import { appConfig, type UiLocale } from "@/config/evn";
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

type ToolCardPayload = {
    toolName: string;
    ok: boolean;
    durationMs: number;
    argsPreview: string;
    resultPreview: string;
};

type ChatRow = {
    id: number;
    role: "user" | "assistant" | "system" | "meta";
    text: string;
    /** Claude Code 风格：工具参数 + 输出块 */
    toolCard?: ToolCardPayload;
    /** 与本轮 WebSocket chat 的 requestId 对齐；done 时可收起中间步骤只保留最终回复 */
    requestId?: string;
};

const MAX_MENU_ROWS = 10;

type ClientModelRow = { id: string; label: string; driver: string; supportsTools?: boolean };
type ClientModelsPayload = { defaultModelId: string; models: ClientModelRow[] };

function isModelPickerLine(line: string): boolean {
    return line.startsWith("/model ");
}

function filterModelsForPicker(models: ClientModelRow[], line: string): ClientModelRow[] {
    if (!line.startsWith("/model ")) return [];
    const q = line.slice("/model ".length).trim().toLowerCase();
    if (!q) return [...models];
    return models.filter(
        (m) =>
            m.id.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            (m.driver && m.driver.toLowerCase().includes(q)),
    );
}

/** 与服务端 wsGateway 的 requestId 对齐（string | number | 缺省） */
function normalizeWsRequestId(raw: unknown): string {
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return "";
}

/** 请求结束后移除「思考中 / 工具卡 / 中间 assistant」，仅保留该请求下最后一条纯文本 assistant */
function collapseTransientStepsForRequest(lines: ChatRow[], rid: string): ChatRow[] {
    if (!rid) return lines;
    let lastPlainIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (l.requestId !== rid) continue;
        if (l.role === "assistant" && !l.toolCard) {
            lastPlainIdx = i;
            break;
        }
    }
    return lines.filter((l, i) => {
        if (l.role === "user" || l.role === "system") return true;
        if (l.requestId !== rid) return true;
        if (l.role === "meta") return false;
        if (l.role === "assistant" && l.toolCard) return false;
        if (l.role === "assistant" && !l.toolCard) {
            if (lastPlainIdx < 0) return false;
            if (i !== lastPlainIdx) return false;
            return l.text.trim().length > 0;
        }
        return true;
    });
}

/**
 * 将尚未写入 React state 的 delta 缓冲合并进 active（与 WebSocket handler 内逻辑一致）。
 * 用于定时刷新、done/assistant 收尾，避免「缓冲里还有字但 state 未更新」。
 */
function applyDeltaChunksToActive(
    active: ChatRow[],
    chunks: Map<string, string>,
    nextLineIdRef: { current: number },
    deltaLineIdByRequestRef: { current: Map<string, number> },
): ChatRow[] {
    let out = active;
    for (const [rid, chunk] of chunks) {
        if (!chunk) continue;
        let lid = deltaLineIdByRequestRef.current.get(rid);
        if (lid == null) {
            lid = nextLineIdRef.current++;
            deltaLineIdByRequestRef.current.set(rid, lid);
            out = [...out, { id: lid, role: "assistant", text: chunk, requestId: rid }];
        } else {
            out = out.map((row) =>
                row.id === lid ? { ...row, text: row.text + chunk, requestId: rid } : row
            );
        }
    }
    return out;
}

/** 流式 delta 合并到 UI 的间隔：过小易闪屏，过大则跟手略迟（约 20fps） */
const DELTA_FLUSH_MS = 50;

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
    /** 区块标题、工具卡边框（参考 Claude Code 蓝色分区） */
    blue: "#38bdf8",
    metaStar: "#f87171",
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

/** 浅色分隔线：宽度与下方输入栏一致（`barCols` 已为内容区列数，勿再缩短） */
function inputDivider(barCols: number): string {
    const n = Math.max(8, barCols);
    return "─".repeat(n);
}

function fitDesc(desc: string, max: number): string {
    if (desc.length <= max) return desc;
    if (max <= 1) return "…";
    return `${desc.slice(0, max - 1)}…`;
}

const ToolCardView = memo(function ToolCardViewInner({
    card,
    wrapW,
    locale,
}: {
    card: ToolCardPayload;
    wrapW: number;
    locale: UiLocale;
}): React.ReactElement {
    const contentW = Math.max(16, wrapW);
    const title = T.tuiToolCardSectionTitle(locale, card.toolName);
    const ms = Math.max(0, Math.round(card.durationMs));
    const okLabel = card.ok
        ? locale === "en"
            ? "ok"
            : "成功"
        : locale === "en"
          ? "failed"
          : "失败";
    const argText =
        card.argsPreview.trim() || (locale === "en" ? "(no args)" : "（无参数）");
    const outText =
        card.resultPreview.trim() || (locale === "en" ? "(no output)" : "（无输出）");
    const argLines = wrapText(argText, contentW);
    const outLines = wrapText(outText, contentW);

    return (
        <Box
            flexDirection="column"
            marginBottom={0.5}
            marginTop={0.5}
            borderStyle="round"
            borderColor={THEME.blue}
            paddingX={1}
            paddingY={0.5}
        >
            <Box flexDirection="column" marginBottom={0.5}>
                <Text>
                    <Text color={THEME.blue} bold>
                        {title}
                    </Text>
                    <Text color={THEME.grayDim}>
                        {" · "}
                        {card.toolName}
                        {" · "}
                        {ms}ms · {okLabel}
                    </Text>
                </Text>
            </Box>
            <Text dimColor>{T.tuiToolCardArgsLabel(locale)}</Text>
            {argLines.map((line, j) => (
                <Text key={`arg-${j}`} color={THEME.grayDim}>
                    {line}
                </Text>
            ))}
            <Box marginTop={0.5} flexDirection="column">
                <Text dimColor>{T.tuiToolCardOutputLabel(locale)}</Text>
                {outLines.map((line, j) => (
                    <Text key={`out-${j}`} color={THEME.white}>
                        {line}
                    </Text>
                ))}
            </Box>
        </Box>
    );
});

type MessageBlockProps = {
    row: ChatRow;
    wrapW: number;
    locale: UiLocale;
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
    locale,
}: MessageBlockProps): React.ReactElement {
    const indent = "  ";
    const contIndent = "    ";
    const contentW = Math.max(8, wrapW);

    if (row.role === "meta") {
        const lines = wrapText(row.text, contentW);
        return (
            <Box flexDirection="column" marginBottom={0.25} marginTop={0.25}>
                {lines.map((line, j) => (
                    <Text key={j}>
                        <Text color={THEME.metaStar} bold>
                            {"* "}
                        </Text>
                        <Text color={THEME.grayDim}>{line}</Text>
                    </Text>
                ))}
            </Box>
        );
    }

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
                <Text dimColor>{dimRule(contentW)}</Text>
            </Box>
        );
    }

    if (row.role === "assistant" && row.toolCard) {
        return (
            <Box flexDirection="column" marginBottom={0.5} marginTop={0.5}>
                <ToolCardView card={row.toolCard} wrapW={contentW} locale={locale} />
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
                                <Text color={THEME.white} bold>
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

type ModelSlashMenuProps = {
    entries: ClientModelRow[];
    selectedIndex: number;
    cols: number;
    locale: UiLocale;
};

type RiskSlashMenuProps = {
    kind: "session" | "task";
    selectedIndex: number;
    locale: UiLocale;
};

const RiskSlashMenu = memo(function RiskSlashMenuInner({
    kind,
    selectedIndex,
    locale,
}: RiskSlashMenuProps): React.ReactElement {
    const [a, b] = T.riskMenuEntries(locale);
    const entries = [a, b];
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={THEME.blue}
            borderDimColor={false}
            paddingX={1}
            paddingY={1}
            marginTop={1}
        >
            <Text color={THEME.orangeMuted}>{T.riskMenuTitle(locale, kind)}</Text>
            {entries.map((e, i) => {
                const active = i === selectedIndex;
                return (
                    <Box key={e.label} flexDirection="row" marginTop={i === 0 ? 1 : 0} marginBottom={0}>
                        <Text
                            color={active ? THEME.blue : undefined}
                            dimColor={!active}
                            bold={active}
                        >
                            {active ? "› " : "  "}
                        </Text>
                        <Text
                            color={active ? THEME.menuSelect : THEME.white}
                            bold={active}
                            dimColor={!active}
                            wrap="truncate-end"
                        >
                            {e.label}
                        </Text>
                    </Box>
                );
            })}
            <Box marginTop={1}>
                <Text color={THEME.grayDim}>{T.riskMenuFooter(locale)}</Text>
            </Box>
        </Box>
    );
});

const ModelSlashMenu = memo(function ModelSlashMenuInner({
    entries,
    selectedIndex,
    cols,
    locale,
}: ModelSlashMenuProps): React.ReactElement {
    const visible = entries.slice(0, MAX_MENU_ROWS);
    const more = entries.length > MAX_MENU_ROWS;
    const maxIdLen = visible.length ? Math.max(...visible.map((e) => e.id.length)) : 8;
    const idW = Math.min(18, maxIdLen + 1);
    const driverW = 8;
    const labelMax = Math.max(10, cols - idW - driverW - 8);

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={THEME.blue}
            borderDimColor={false}
            paddingX={1}
            paddingY={1}
            marginTop={1}
        >
            <Text color={THEME.orangeMuted}>{T.modelMenuBar(locale)}</Text>
            {visible.map((e, i) => {
                const active = i === selectedIndex;
                const lab = fitDesc(e.label, labelMax);
                const gap = Math.max(1, idW - e.id.length);
                return (
                    <Box
                        key={e.id}
                        flexDirection="row"
                        marginBottom={i < visible.length - 1 ? 1 : 0}
                    >
                        <Text
                            color={active ? THEME.blue : undefined}
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
                            {e.id}
                        </Text>
                        <Text color={THEME.grayDim}>{" ".repeat(gap)} </Text>
                        <Text color={active ? THEME.gray : THEME.grayDim} wrap="truncate-end">
                            {lab}
                        </Text>
                        <Text color={THEME.grayDim}>{"  "}</Text>
                        <Text color={THEME.orangeMuted} dimColor={!active}>
                            {e.driver}
                        </Text>
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

    /**
     * 已结束轮次进 archived，当前请求在 active（done 时折叠后并入 archived）。
     * 勿对聊天使用 Ink Static：Static 追加内容时会触发整段动态区重绘，顶栏会重复出现在滚动缓冲里。
     */
    const [chat, setChat] = useState<{ archived: ChatRow[]; active: ChatRow[] }>({
        archived: [],
        active: [],
    });
    const archivedLines = chat.archived;
    const activeLines = chat.active;
    const transcriptLines = useMemo(
        () => [...archivedLines, ...activeLines],
        [archivedLines, activeLines],
    );
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
    const busyRef = useRef(false);
    busyRef.current = busy;
    const [slashIndex, setSlashIndex] = useState(0);
    const [modelCatalog, setModelCatalog] = useState<ClientModelsPayload | null>(null);
    const [selectedModelId, setSelectedModelId] = useState("");
    const [modelPickIndex, setModelPickIndex] = useState(0);
    /** 高风险 / 任务待审批：菜单选择（与 Claude Code 式列表一致，避免手打「同意」） */
    const [riskPending, setRiskPending] = useState<"session" | "task" | null>(null);
    const [riskPickIndex, setRiskPickIndex] = useState(0);
    const modelCatalogRef = useRef<ClientModelsPayload | null>(null);
    const modelPickIndexRef = useRef(0);
    const riskPickIndexRef = useRef(0);
    const submitRef = useRef<(value: string) => void | Promise<void>>(() => {});
    const wsRef = useRef<WebSocket | null>(null);
    const requestSeqRef = useRef(1);
    /** 服务端当前正在生成的那条请求（用于 Ctrl+G cancel） */
    const activeRequestIdRef = useRef<string | null>(null);
    /** 按 requestId 跟踪，避免客户端提前重置与服务端队列不一致导致错位 */
    const pendingByIdRef = useRef<Map<string, { gotAssistant: boolean; gotError: boolean }>>(
        new Map()
    );
    const inputRef = useRef(input);
    const slashIndexRef = useRef(slashIndex);
    const nextLineIdRef = useRef(1);
    /** WebSocket delta 与最终 assistant 合并到同一行 */
    const deltaLineIdByRequestRef = useRef<Map<string, number>>(new Map());
    /** 尚未刷入 state 的流式片段（按 requestId 合并），降低每 token 整页重绘导致的闪屏 */
    const deltaBufferRef = useRef<Map<string, string>>(new Map());
    const deltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushPendingDeltas = useCallback(() => {
        if (deltaFlushTimerRef.current != null) {
            clearTimeout(deltaFlushTimerRef.current);
            deltaFlushTimerRef.current = null;
        }
        if (deltaBufferRef.current.size === 0) return;
        const snapshot = new Map(deltaBufferRef.current);
        deltaBufferRef.current.clear();
        setChat((c) => ({
            ...c,
            active: applyDeltaChunksToActive(
                c.active,
                snapshot,
                nextLineIdRef,
                deltaLineIdByRequestRef
            ),
        }));
    }, []);

    const scheduleDeltaFlush = useCallback(() => {
        if (deltaFlushTimerRef.current != null) return;
        deltaFlushTimerRef.current = setTimeout(() => {
            deltaFlushTimerRef.current = null;
            flushPendingDeltas();
        }, DELTA_FLUSH_MS);
    }, [flushPendingDeltas]);

    inputRef.current = input;
    slashIndexRef.current = slashIndex;
    modelCatalogRef.current = modelCatalog;
    modelPickIndexRef.current = modelPickIndex;
    riskPickIndexRef.current = riskPickIndex;

    const appendActiveLine = useCallback((row: Omit<ChatRow, "id">): void => {
        const id = nextLineIdRef.current++;
        setChat((c) => ({ ...c, active: [...c.active, { id, ...row }] }));
    }, []);

    /** 本地 slash 输出：若当前轮仍在 active，追加到 active 末尾，避免插在已归档内容之前 */
    const appendSlashResultLine = useCallback((row: Omit<ChatRow, "id">): void => {
        const id = nextLineIdRef.current++;
        setChat((c) => {
            if (c.active.length > 0) {
                return { ...c, active: [...c.active, { id, ...row }] };
            }
            return { ...c, archived: [...c.archived, { id, ...row }] };
        });
    }, []);

    const filteredSlash = useMemo(
        () => uniqueSlashLabels(filterSlashCommands(input, locale)),
        [input, locale],
    );
    const filteredModels = useMemo(
        () => filterModelsForPicker(modelCatalog?.models ?? [], input),
        [input, modelCatalog],
    );
    const menuVisible = isSlashMenuLine(input) && filteredSlash.length > 0;
    const modelMenuVisible = isModelPickerLine(input);
    const riskMenuVisible = riskPending !== null && !busy;

    const selectedModelLabel = useMemo(() => {
        if (!selectedModelId.trim()) return "";
        const e = modelCatalog?.models.find((m) => m.id === selectedModelId);
        return e ? `${e.id} · ${fitDesc(e.label, 40)}` : selectedModelId;
    }, [selectedModelId, modelCatalog]);

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

    useEffect(() => {
        if (filteredModels.length === 0) {
            setModelPickIndex(0);
            return;
        }
        setModelPickIndex((i) => Math.min(i, filteredModels.length - 1));
    }, [filteredModels]);

    useEffect(() => {
        setRiskPickIndex((i) => Math.min(Math.max(0, i), 1));
    }, [riskPending]);

    useInput((ch, key) => {
        if (key.ctrl && ch === "c") {
            exit();
            return;
        }
        if (key.ctrl && ch === "g") {
            if (!busyRef.current) {
                return;
            }
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
                const rid = activeRequestIdRef.current;
                ws.send(JSON.stringify({ type: "cancel", ...(rid ? { requestId: rid } : {}) }));
            }
            return;
        }
        if (riskPending !== null && !busyRef.current) {
            const [opt0, opt1] = T.riskMenuEntries(locale);
            if (key.escape) {
                void submitRef.current(opt1.submitText);
                setRiskPending(null);
                setRiskPickIndex(0);
                return;
            }
            if (key.return) {
                const pick = riskPickIndexRef.current === 1 ? opt1 : opt0;
                void submitRef.current(pick.submitText);
                setRiskPending(null);
                setRiskPickIndex(0);
                return;
            }
            if (key.upArrow) {
                setRiskPickIndex((i) => (i <= 0 ? 1 : 0));
                return;
            }
            if (key.downArrow) {
                setRiskPickIndex((i) => (i >= 1 ? 0 : 1));
                return;
            }
            return;
        }
        const line = inputRef.current;
        if (isModelPickerLine(line)) {
            const filtered = filterModelsForPicker(modelCatalogRef.current?.models ?? [], line);
            if (key.escape) {
                setInput("");
                setModelPickIndex(0);
                return;
            }
            if (filtered.length > 0) {
                if (key.upArrow) {
                    setModelPickIndex((i) => (i - 1 + filtered.length) % filtered.length);
                    return;
                }
                if (key.downArrow) {
                    setModelPickIndex((i) => (i + 1) % filtered.length);
                    return;
                }
                if (key.tab) {
                    const idx = Math.min(modelPickIndexRef.current, filtered.length - 1);
                    const sel = filtered[idx] ?? filtered[0];
                    if (sel) setInput(`/model ${sel.id}`);
                    return;
                }
            }
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
            setRiskPending(null);
            activeRequestIdRef.current = null;
            pendingByIdRef.current.clear();
            deltaLineIdByRequestRef.current.clear();
            if (deltaFlushTimerRef.current != null) {
                clearTimeout(deltaFlushTimerRef.current);
                deltaFlushTimerRef.current = null;
            }
            deltaBufferRef.current.clear();
            wsRef.current = null;
        });
        ws.on("error", () => {
            setStatus(locale === "en" ? "error" : "error");
            setBusy(false);
            activeRequestIdRef.current = null;
            pendingByIdRef.current.clear();
            deltaLineIdByRequestRef.current.clear();
            if (deltaFlushTimerRef.current != null) {
                clearTimeout(deltaFlushTimerRef.current);
                deltaFlushTimerRef.current = null;
            }
            deltaBufferRef.current.clear();
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
                    toolName?: string;
                    ok?: boolean;
                    durationMs?: number;
                    argsPreview?: string;
                    resultPreview?: string;
                    event?: { type?: string; round?: number };
                    metadata?: {
                        pendingSessionRiskApproval?: unknown;
                        taskStatus?: string;
                    };
                };
                if (msg.type === "ready") {
                    setModel(String(msg.model ?? ""));
                    setAppVersion(String(msg.version ?? ""));
                    const raw = msg as {
                        models?: { defaultModelId?: string; models?: ClientModelRow[] };
                    };
                    if (
                        raw.models &&
                        typeof raw.models.defaultModelId === "string" &&
                        Array.isArray(raw.models.models)
                    ) {
                        setModelCatalog({
                            defaultModelId: raw.models.defaultModelId,
                            models: raw.models.models,
                        });
                        setSelectedModelId(raw.models.defaultModelId);
                    }
                    return;
                }
                if (msg.type === "phase" && msg.event && typeof msg.event === "object") {
                    const ev = msg.event;
                    if (ev.type === "llm.request") {
                        const rid = normalizeWsRequestId(msg.requestId);
                        if (!rid) return;
                        appendActiveLine({
                            role: "meta",
                            text: T.tuiMetaLlmRound(locale, ev.round),
                            requestId: rid,
                        });
                    }
                    return;
                }
                if (msg.type === "tool_start") {
                    const rid = normalizeWsRequestId(msg.requestId);
                    const name = typeof msg.toolName === "string" ? msg.toolName.trim() : "";
                    const ap = typeof msg.argsPreview === "string" ? msg.argsPreview : "";
                    if (!rid || !name) return;
                    if (pendingByIdRef.current.has(rid)) {
                        const st = pendingByIdRef.current.get(rid);
                        if (st) st.gotAssistant = true;
                    }
                    appendActiveLine({
                        role: "meta",
                        text: T.tuiToolRunningLine(locale, name, ap),
                        requestId: rid,
                    });
                    return;
                }
                if (msg.type === "tool") {
                    const rid = normalizeWsRequestId(msg.requestId);
                    const name = typeof msg.toolName === "string" ? msg.toolName.trim() : "";
                    if (!rid || !name) return;
                    if (pendingByIdRef.current.has(rid)) {
                        const st = pendingByIdRef.current.get(rid);
                        if (st) st.gotAssistant = true;
                    }
                    appendActiveLine({
                        role: "assistant",
                        text: "",
                        requestId: rid,
                        toolCard: {
                            toolName: name,
                            ok: msg.ok === true,
                            durationMs:
                                typeof msg.durationMs === "number" && Number.isFinite(msg.durationMs)
                                    ? msg.durationMs
                                    : 0,
                            argsPreview: typeof msg.argsPreview === "string" ? msg.argsPreview : "",
                            resultPreview:
                                typeof msg.resultPreview === "string" ? msg.resultPreview : "",
                        },
                    });
                    return;
                }
                if (msg.type === "delta") {
                    const rid = normalizeWsRequestId(msg.requestId);
                    const chunk = typeof msg.text === "string" ? msg.text : "";
                    if (!rid || !chunk) return;
                    if (pendingByIdRef.current.has(rid)) {
                        const st = pendingByIdRef.current.get(rid);
                        if (st) st.gotAssistant = true;
                    }
                    const buf = deltaBufferRef.current;
                    buf.set(rid, (buf.get(rid) || "") + chunk);
                    scheduleDeltaFlush();
                    return;
                }
                if (msg.type === "assistant") {
                    const ridRaw = normalizeWsRequestId(msg.requestId);
                    const rid = ridRaw || undefined;
                    if (rid && pendingByIdRef.current.has(rid)) {
                        const st = pendingByIdRef.current.get(rid);
                        if (st) st.gotAssistant = true;
                    }
                    if (deltaFlushTimerRef.current != null) {
                        clearTimeout(deltaFlushTimerRef.current);
                        deltaFlushTimerRef.current = null;
                    }
                    const pending = new Map(deltaBufferRef.current);
                    deltaBufferRef.current.clear();
                    if (rid) pending.delete(rid);

                    const full = String(msg.text ?? "");
                    const streamLid = rid ? deltaLineIdByRequestRef.current.get(rid) : undefined;

                    setChat((c) => {
                        let active = applyDeltaChunksToActive(
                            c.active,
                            pending,
                            nextLineIdRef,
                            deltaLineIdByRequestRef
                        );
                        if (rid && streamLid != null) {
                            deltaLineIdByRequestRef.current.delete(rid);
                            active = active.map((row) =>
                                row.id === streamLid
                                    ? { ...row, text: full, requestId: rid }
                                    : row
                            );
                        } else {
                            const id = nextLineIdRef.current++;
                            active = [
                                ...active,
                                { id, role: "assistant", text: full, ...(rid ? { requestId: rid } : {}) },
                            ];
                        }
                        return { ...c, active };
                    });
                    const meta = msg.metadata;
                    if (meta?.pendingSessionRiskApproval) {
                        setRiskPending("session");
                        setRiskPickIndex(0);
                    } else if (meta?.taskStatus === "pending_approval" && taskId) {
                        setRiskPending("task");
                        setRiskPickIndex(0);
                    } else {
                        setRiskPending((prev) => (prev ? null : prev));
                    }
                    return;
                }
                if (msg.type === "started") {
                    setBusy(true);
                    const sid = normalizeWsRequestId(msg.requestId);
                    if (sid) {
                        activeRequestIdRef.current = sid;
                        if (!pendingByIdRef.current.has(sid)) {
                            pendingByIdRef.current.set(sid, {
                                gotAssistant: false,
                                gotError: false,
                            });
                        }
                    }
                    return;
                }
                if (msg.type === "done") {
                    const rid = normalizeWsRequestId(msg.requestId);
                    if (deltaFlushTimerRef.current != null) {
                        clearTimeout(deltaFlushTimerRef.current);
                        deltaFlushTimerRef.current = null;
                    }
                    if (rid) {
                        if (activeRequestIdRef.current === rid) {
                            activeRequestIdRef.current = null;
                        }
                        const pending = pendingByIdRef.current.get(rid);
                        pendingByIdRef.current.delete(rid);
                        setChat((c) => {
                            const buf = new Map(deltaBufferRef.current);
                            deltaBufferRef.current.clear();
                            let merged = applyDeltaChunksToActive(
                                c.active,
                                buf,
                                nextLineIdRef,
                                deltaLineIdByRequestRef
                            );
                            if (pending && !pending.gotAssistant && !pending.gotError) {
                                const id = nextLineIdRef.current++;
                                merged = [
                                    ...merged,
                                    {
                                        id,
                                        role: "system",
                                        text: T.errDoneNoContent(locale),
                                        requestId: rid,
                                    },
                                ];
                            }
                            const collapsed = collapseTransientStepsForRequest(merged, rid);
                            return {
                                archived: [...c.archived, ...collapsed],
                                active: [],
                            };
                        });
                    } else {
                        /** 服务端若未回显 requestId（旧实现或异常帧），否则 pending 无法删除，busy 会永久为 true */
                        if (activeRequestIdRef.current) {
                            pendingByIdRef.current.delete(activeRequestIdRef.current);
                        }
                        activeRequestIdRef.current = null;
                        pendingByIdRef.current.clear();
                        deltaLineIdByRequestRef.current.clear();
                        setChat((c) => {
                            const buf = new Map(deltaBufferRef.current);
                            deltaBufferRef.current.clear();
                            const merged = applyDeltaChunksToActive(
                                c.active,
                                buf,
                                nextLineIdRef,
                                deltaLineIdByRequestRef
                            );
                            return {
                                archived: [...c.archived, ...merged],
                                active: [],
                            };
                        });
                    }
                    setBusy(pendingByIdRef.current.size > 0);
                    return;
                }
                if (msg.type === "error") {
                    const rid = normalizeWsRequestId(msg.requestId);
                    if (rid) {
                        deltaBufferRef.current.delete(rid);
                        deltaLineIdByRequestRef.current.delete(rid);
                        pendingByIdRef.current.delete(rid);
                    }
                    if (deltaFlushTimerRef.current != null) {
                        clearTimeout(deltaFlushTimerRef.current);
                        deltaFlushTimerRef.current = null;
                    }
                    const raw = String(msg.message ?? "");
                    const message =
                        raw === "This operation was aborted" ? T.errAborted(locale) : raw;
                    const errLine = `${T.errPrefix(locale)}${message}`;
                    setChat((c) => {
                        const buf = new Map(deltaBufferRef.current);
                        deltaBufferRef.current.clear();
                        let active = applyDeltaChunksToActive(
                            c.active,
                            buf,
                            nextLineIdRef,
                            deltaLineIdByRequestRef
                        );
                        const id = nextLineIdRef.current++;
                        active = [...active, { id, role: "system", text: errLine }];
                        return { ...c, active };
                    });
                    setBusy(pendingByIdRef.current.size > 0);
                    return;
                }
            } catch {
                /* ignore */
            }
        });
        return () => {
            if (deltaFlushTimerRef.current != null) {
                clearTimeout(deltaFlushTimerRef.current);
                deltaFlushTimerRef.current = null;
            }
            deltaBufferRef.current.clear();
            ws.close();
            wsRef.current = null;
        };
    }, [appendActiveLine, flushPendingDeltas, locale, scheduleDeltaFlush, taskId, wsUrl]);

    const runLocalSlash = useCallback(
        async (fullLine: string): Promise<boolean> => {
            const text = fullLine.trim();
            if (text === "/exit" || text === "/quit") {
                exit();
                return true;
            }
            if (text === "/help" || text === "/?") {
                appendSlashResultLine({
                    role: "system",
                    text: T.tuiHelpLines(locale, { sessionKey, taskId }),
                });
                return true;
            }
            if (text === "/clear") {
                setChat({ archived: [], active: [] });
                return true;
            }
            if (text === "/status") {
                appendSlashResultLine({
                    role: "system",
                    text: T.tuiStatusLines(locale, { sessionKey, agentId, taskId }),
                });
                return true;
            }
            if (text === "/workspace") {
                appendSlashResultLine({
                    role: "system",
                    text: T.tuiWorkspaceLines(locale),
                });
                return true;
            }
            if (text.startsWith("/session")) {
                const rest = text.slice("/session".length).trim();
                if (!rest) {
                    appendSlashResultLine({ role: "system", text: T.usageSession(locale) });
                    return true;
                }
                setSessionKey(rest);
                appendSlashResultLine({
                    role: "system",
                    text: T.sessionSwitched(locale, rest, taskId),
                });
                return true;
            }
            if (text.startsWith("/model")) {
                const rest = text.slice("/model".length).trim();
                if (!rest) {
                    appendSlashResultLine({ role: "system", text: T.usageModel(locale) });
                    return true;
                }
                const id = rest.split(/\s+/)[0] ?? "";
                if (!modelCatalog?.models.some((m) => m.id === id)) {
                    appendSlashResultLine({ role: "system", text: T.modelUnknown(locale, id) });
                    return true;
                }
                const entry = modelCatalog!.models.find((m) => m.id === id)!;
                setSelectedModelId(id);
                appendSlashResultLine({
                    role: "system",
                    text: T.modelSwitched(locale, id, entry.label),
                });
                return true;
            }
            if (text.startsWith("/")) {
                const out = await runTerminalSlash(text);
                if (out !== null) {
                    appendSlashResultLine({ role: "system", text: out });
                    return true;
                }
                appendSlashResultLine({ role: "system", text: T.unknownCommand(locale) });
                return true;
            }
            return false;
        },
        [agentId, appendSlashResultLine, exit, locale, modelCatalog, sessionKey, taskId]
    );

    const submit = useCallback(
        async (value: string) => {
            const v = value.trim();
            if (!v) return;

            // 普通问答走快速路径：先上屏用户消息，再发 ws，减少回车后的可感知延迟。
            if (!v.startsWith("/")) {
                if (busyRef.current) {
                    appendActiveLine({ role: "system", text: T.tuiBusyBlockSend(locale) });
                    return;
                }
                setInput("");
                const ws = wsRef.current;
                if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
                    appendActiveLine({ role: "system", text: T.errNotConnected(locale) });
                    return;
                }
                const requestId = `req-${requestSeqRef.current++}`;
                appendActiveLine({ role: "user", text: v, requestId });
                setBusy(true);
                ws.send(
                    JSON.stringify({
                        type: "chat",
                        requestId,
                        text: v,
                        sessionKey,
                        ...(agentId ? { agentId } : {}),
                        ...(taskId ? { taskId } : {}),
                        ...(selectedModelId.trim() ? { modelId: selectedModelId.trim() } : {}),
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
                            if (sel.cmd === "/session") {
                                appendSlashResultLine({ role: "system", text: T.needsArgSession(locale) });
                                return;
                            }
                            if (sel.cmd === "/model") {
                                const line = inputRef.current;
                                if (isModelPickerLine(line)) {
                                    const filtered = filterModelsForPicker(
                                        modelCatalogRef.current?.models ?? [],
                                        line,
                                    );
                                    if (filtered.length > 0) {
                                        const idx = Math.min(
                                            modelPickIndexRef.current,
                                            Math.max(0, filtered.length - 1),
                                        );
                                        const picked = filtered[idx];
                                        if (picked) {
                                            setInput("");
                                            await runLocalSlash(`/model ${picked.id}`);
                                            return;
                                        }
                                    }
                                }
                                setInput("/model ");
                                setModelPickIndex(0);
                                return;
                            }
                            appendSlashResultLine({ role: "system", text: T.needsArgGeneric(locale) });
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

            if (busyRef.current) {
                appendActiveLine({ role: "system", text: T.tuiBusyBlockSend(locale) });
                return;
            }
            setInput("");
            const ws = wsRef.current;
            if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
                appendActiveLine({ role: "system", text: T.errNotConnected(locale) });
                return;
            }
            const requestId = `req-${requestSeqRef.current++}`;
            appendActiveLine({ role: "user", text: v, requestId });
            setBusy(true);
            ws.send(
                JSON.stringify({
                    type: "chat",
                    requestId,
                    text: v,
                    sessionKey,
                    ...(agentId ? { agentId } : {}),
                    ...(taskId ? { taskId } : {}),
                    ...(selectedModelId.trim() ? { modelId: selectedModelId.trim() } : {}),
                })
            );
        },
        [
            agentId,
            appendActiveLine,
            appendSlashResultLine,
            connected,
            locale,
            runLocalSlash,
            selectedModelId,
            sessionKey,
            slashIndex,
            taskId,
        ]
    );

    submitRef.current = submit;

    /** 斜杠 /model 菜单占位；不截断聊天记录，由终端缓冲区纵向滚动（瀑布流） */
    const menuReserveLines = riskMenuVisible ? 12 : menuVisible || modelMenuVisible ? 13 : 1;
    const urlLine = truncateMiddle(wsUrl, Math.max(20, cols - 8));
    /** 与聊天区内边距一致：左右各 1 列（不可大于 `cols-2`，否则窄终端下边框会错位） */
    const barCols = Math.max(8, cols - 2);
    /** `>` 之后可用的正文列宽 */
    const textCols = Math.max(16, barCols - 2);

    const metaBits = [
        connected ? T.metaReady(locale) : T.wsStatusLabel(locale, status),
        selectedModelLabel || model || null,
        busyUi ? T.metaStreaming(locale) : riskPending ? T.metaRiskAwaiting(locale) : T.metaIdle(locale),
        busyUi ? T.metaStopGen(locale) : null,
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
                {transcriptLines.length === 0 && !busy ? (
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
                        {transcriptLines.map((row) => (
                            <MessageBlock key={row.id} row={row} wrapW={textCols} locale={locale} />
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
                {riskMenuVisible ? (
                    <RiskSlashMenu
                        kind={riskPending ?? "session"}
                        selectedIndex={riskPickIndex}
                        locale={locale}
                    />
                ) : menuVisible ? (
                    <SlashMenu
                        entries={filteredSlash}
                        selectedIndex={slashIndex}
                        cols={Math.max(40, cols - 2)}
                        locale={locale}
                    />
                ) : modelMenuVisible ? (
                    !modelCatalog ? (
                        <Text color={THEME.grayDim}>{T.modelsNotLoaded(locale)}</Text>
                    ) : filteredModels.length === 0 ? (
                        <Text color={THEME.warn}>
                            {locale === "en" ? "No model id matches." : "无匹配的模型 id。"}
                        </Text>
                    ) : (
                        <ModelSlashMenu
                            entries={filteredModels}
                            selectedIndex={modelPickIndex}
                            cols={Math.max(40, cols - 2)}
                            locale={locale}
                        />
                    )
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
                <Box marginBottom={1}>
                    <Text color={THEME.gray}>
                        {riskMenuVisible ? T.riskMenuFooter(locale) : T.tuiInputFooter(locale)}
                    </Text>
                </Box>
                <Box
                    flexDirection="row"
                    alignItems="center"
                    paddingX={0}
                    paddingY={0}
                    borderStyle="single"
                    borderColor={connected ? THEME.orangeBright : THEME.warn}
                    borderDimColor={false}
                    minHeight={3}
                    width={barCols}
                >
                    <Text bold color={THEME.white}>
                        {riskMenuVisible ? "  " : "> "}
                    </Text>
                    <Box flexGrow={1} minWidth={0} overflow="hidden">
                        <TextInput
                            value={riskMenuVisible ? "" : input}
                            onChange={riskMenuVisible ? () => {} : setInput}
                            onSubmit={submit}
                            placeholder={
                                riskMenuVisible
                                    ? locale === "en"
                                        ? "Use menu above ↑↓ Enter"
                                        : "请用上方菜单 ↑↓ Enter"
                                    : T.tuiPlaceholder(locale)
                            }
                            showCursor={!riskMenuVisible}
                        />
                    </Box>
                </Box>
            </Box>

            <Box marginTop={0.5} flexDirection="column" flexShrink={0}>
                <StatusStrip cols={cols} parts={metaBits} />
                <Text color={THEME.grayDim}> {T.tuiBottomHint(locale)}</Text>
                <Text color={THEME.grayDim}> {T.tuiFooterActionHints(locale)}</Text>
            </Box>
        </Box>
    );
}
