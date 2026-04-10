import type { Conversation } from "@/chat/types";
import { formatDateTime } from "@/lib/formatDateTime";
import { useLocale } from "@/locale/LocaleContext";
import { Button } from "@/components/ui";
import { IconTrash } from "@/components/icons";

type Props = {
    conversations: Conversation[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onNewChat: () => void;
    onDelete?: (id: string) => void;
    mobileOpen: boolean;
    onCloseMobile: () => void;
};

function previewTitle(c: Conversation, newChatLabel: string, legacyZh: string): string {
    if (c.title && c.title !== newChatLabel && c.title !== legacyZh) {
        return c.title;
    }
    const firstUser = c.messages.find((m) => m.role === "user");
    if (firstUser) {
        const t = firstUser.text.trim().replace(/\s+/g, " ");
        return t.length > 28 ? `${t.slice(0, 28)}…` : t;
    }
    return newChatLabel;
}

export function ChatSidebar({
    conversations,
    activeId,
    onSelect,
    onNewChat,
    onDelete,
    mobileOpen,
    onCloseMobile,
}: Props) {
    const { locale, t } = useLocale();
    const sorted = [...conversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const rowActive = "bg-slate-200/90 dark:bg-slate-800/90";
    const rowHover = "hover:bg-slate-100 dark:hover:bg-slate-800/40";

    const list = (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-slate-200/90 p-2 dark:border-slate-800/90">
                <Button type="button" className="w-full" onClick={onNewChat}>
                    {t("chat.newChatBtn")}
                </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {sorted.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-slate-500">{t("chat.noHistory")}</p>
                ) : (
                    sorted.map((c) => (
                        <div
                            key={c.id}
                            className={`group flex items-stretch gap-0.5 rounded-xl border border-transparent transition ${activeId === c.id ? rowActive : rowHover}`}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    onSelect(c.id);
                                    onCloseMobile();
                                }}
                                className={`min-w-0 flex-1 px-3 py-2.5 text-left text-sm ${
                                    activeId === c.id
                                        ? "text-claw-800 dark:text-claw-200"
                                        : "text-slate-700 dark:text-slate-300"
                                }`}
                            >
                                <span className="line-clamp-2 font-medium">
                                    {previewTitle(c, t("chat.newChat"), "新对话")}
                                </span>
                                <span className="mt-0.5 block text-[10px] text-slate-500">
                                    {formatDateTime(c.updatedAt, locale)}
                                </span>
                            </button>
                            {onDelete && (
                                <button
                                    type="button"
                                    title={t("chat.deleteChat")}
                                    aria-label={t("chat.deleteChat")}
                                    className="flex w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 opacity-80 transition hover:bg-rose-500/15 hover:text-rose-600 group-hover:opacity-100 dark:text-slate-500 dark:hover:bg-rose-500/20 dark:hover:text-rose-400"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(c.id);
                                    }}
                                >
                                    <IconTrash className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    return (
        <>
            <aside className="hidden w-[min(100%,280px)] shrink-0 flex-col border-r border-slate-200/90 bg-white/60 md:flex dark:border-slate-800/90 dark:bg-slate-950/50">
                <p className="border-b border-slate-200/90 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800/90">
                    {t("chat.sidebarTitle")}
                </p>
                {list}
            </aside>

            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] dark:bg-black/60"
                        aria-label={t("chat.closeSidebarAria")}
                        onClick={onCloseMobile}
                    />
                    <div className="relative ml-0 flex h-full w-[min(88vw,300px)] flex-col border-r border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {t("chat.sidebarTitle")}
                            </span>
                            <button
                                type="button"
                                onClick={onCloseMobile}
                                className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("chat.closeDrawer")}
                            </button>
                        </div>
                        {list}
                    </div>
                </div>
            )}
        </>
    );
}
