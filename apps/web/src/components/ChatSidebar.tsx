import type { Conversation } from "@/chat/types";
import { Button } from "@/components/ui";

type Props = {
    conversations: Conversation[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onNewChat: () => void;
    mobileOpen: boolean;
    onCloseMobile: () => void;
};

function previewTitle(c: Conversation): string {
    if (c.title && c.title !== "新对话") {
        return c.title;
    }
    const firstUser = c.messages.find((m) => m.role === "user");
    if (firstUser) {
        const t = firstUser.text.trim().replace(/\s+/g, " ");
        return t.length > 28 ? `${t.slice(0, 28)}…` : t;
    }
    return "新对话";
}

export function ChatSidebar({
    conversations,
    activeId,
    onSelect,
    onNewChat,
    mobileOpen,
    onCloseMobile,
}: Props) {
    const sorted = [...conversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const list = (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-slate-800/90 p-2">
                <Button type="button" className="w-full" onClick={onNewChat}>
                    + 新对话
                </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {sorted.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-slate-500">暂无历史</p>
                ) : (
                    sorted.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                                onSelect(c.id);
                                onCloseMobile();
                            }}
                            className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                activeId === c.id
                                    ? "bg-slate-800 text-claw-200"
                                    : "text-slate-300 hover:bg-slate-800/60"
                            }`}
                        >
                            <span className="line-clamp-2 font-medium">{previewTitle(c)}</span>
                            <span className="mt-0.5 block text-[10px] text-slate-500">
                                {new Date(c.updatedAt).toLocaleString()}
                            </span>
                        </button>
                    ))
                )}
            </div>
        </div>
    );

    return (
        <>
            {/* 桌面侧栏 */}
            <aside className="hidden w-[min(100%,280px)] shrink-0 flex-col border-r border-slate-800/90 bg-slate-950/50 md:flex">
                <p className="border-b border-slate-800/90 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    历史对话
                </p>
                {list}
            </aside>

            {/* 移动端抽屉 */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/60"
                        aria-label="关闭侧栏"
                        onClick={onCloseMobile}
                    />
                    <div className="relative ml-0 flex h-full w-[min(88vw,300px)] flex-col border-r border-slate-800 bg-slate-950 shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                            <span className="text-sm font-medium text-slate-200">历史对话</span>
                            <button
                                type="button"
                                onClick={onCloseMobile}
                                className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                            >
                                关闭
                            </button>
                        </div>
                        {list}
                    </div>
                </div>
            )}
        </>
    );
}
