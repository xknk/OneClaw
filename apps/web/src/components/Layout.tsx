import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui";
import { getProfile } from "@/lib/localUser";

const nav = [
    { to: "/", label: "对话", icon: "◆" },
    { to: "/tasks", label: "任务", icon: "▣" },
    { to: "/templates", label: "模板", icon: "◇" },
    { to: "/settings", label: "设置", icon: "○" },
];

export function Layout() {
    const navigate = useNavigate();
    const { hasToken, logout } = useAuth();
    const profile = getProfile();

    return (
        <div className="flex min-h-dvh flex-col">
            <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 px-4 py-3 backdrop-blur-md safe-pt">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-claw-400 to-teal-700 text-lg font-bold text-slate-950 shadow-glow">
                                O
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-base font-semibold tracking-tight text-white">OneClaw</h1>
                                <p className="truncate text-[11px] text-slate-500">
                                    {hasToken
                                        ? profile?.displayName || `已登录 · ${profile?.userId.slice(0, 8)}…`
                                        : "访客 · 未登录"}
                                </p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {!hasToken ? (
                                <Button
                                    type="button"
                                    className="min-h-9 px-4 text-xs sm:text-sm"
                                    onClick={() => navigate("/login")}
                                >
                                    登录
                                </Button>
                            ) : (
                                <span className="rounded-full bg-emerald-950/80 px-2 py-0.5 text-[10px] font-medium text-emerald-300/90">
                                    已登录
                                </span>
                            )}
                        </div>
                    </div>
                    <nav className="hidden items-center gap-1 sm:flex">
                        {nav.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.to === "/"}
                                className={({ isActive }) =>
                                    `rounded-lg px-3 py-2 text-sm font-medium transition ${
                                        isActive
                                            ? "bg-slate-800 text-claw-300"
                                            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                                    }`
                                }
                            >
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                    <div className="hidden flex-wrap items-center justify-end gap-2 sm:flex">
                        {hasToken && (
                            <button
                                type="button"
                                onClick={() => {
                                    logout();
                                    navigate("/", { replace: true });
                                }}
                                className="rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
                            >
                                退出登录
                            </button>
                        )}
                        <NavLink
                            to="/login"
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-claw-400"
                        >
                            {hasToken ? "令牌设置" : "登录 / 注册"}
                        </NavLink>
                    </div>
                </div>
            </header>

            <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-24 pt-4 sm:pb-8">
                <Outlet />
            </main>

            <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800/90 bg-slate-950/95 pb-safe backdrop-blur-lg sm:hidden">
                <div className="mx-auto flex max-w-6xl justify-around safe-pb">
                    {nav.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === "/"}
                            className={({ isActive }) =>
                                `flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium ${
                                    isActive ? "text-claw-300" : "text-slate-500"
                                }`
                            }
                        >
                            <span className="text-base leading-none">{item.icon}</span>
                            {item.label}
                        </NavLink>
                    ))}
                </div>
            </nav>
        </div>
    );
}
