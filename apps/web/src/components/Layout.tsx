import { useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/locale/LocaleContext";
import { useTheme } from "@/theme/ThemeContext";
import { Button } from "@/components/ui";
import { IconMoon, IconSun } from "@/components/icons";
import { getProfile } from "@/lib/localUser";

export function Layout() {
    const navigate = useNavigate();
    const location = useLocation();
    const { hasToken, logout } = useAuth();
    const { t } = useLocale();
    const { resolved, toggleLightDark } = useTheme();
    const profile = getProfile();
    const isChatRoute = location.pathname === "/";

    const nav = useMemo(
        () => [
            { to: "/", label: t("nav.chat"), icon: "◆" },
            { to: "/tasks", label: t("nav.tasks"), icon: "▣" },
            { to: "/templates", label: t("nav.templates"), icon: "◇" },
            { to: "/workspace", label: t("nav.workspace"), icon: "◎" },
            { to: "/settings", label: t("nav.settings"), icon: "○" },
        ],
        [t],
    );

    const navInactive =
        "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200";
    const navActive =
        "bg-slate-200 text-claw-800 dark:bg-slate-800 dark:text-claw-300";

    return (
        <div
            className={
                isChatRoute
                    ? "flex h-dvh max-h-dvh min-h-0 flex-col overflow-x-hidden overflow-y-hidden overscroll-none"
                    : "flex min-h-dvh flex-col"
            }
        >
            <header className="sticky top-0 z-40 shrink-0 border-b border-slate-200/90 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85 safe-pt">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-claw-400 to-teal-700 text-lg font-bold text-white shadow-glow dark:text-slate-950">
                                O
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                                    OneClaw
                                </h1>
                                <p className="truncate text-[11px] text-slate-500 dark:text-slate-500">
                                    {hasToken
                                        ? profile?.displayName ||
                                          t("layout.brandSubtitleLoggedIn", {
                                              id: profile?.userId.slice(0, 8) ?? "",
                                          })
                                        : t("layout.brandSubtitleGuest")}
                                </p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={toggleLightDark}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-claw-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-claw-300"
                                title={t("layout.themeToggle")}
                                aria-label={t("layout.themeToggle")}
                            >
                                {resolved === "dark" ? (
                                    <IconSun className="h-[18px] w-[18px]" />
                                ) : (
                                    <IconMoon className="h-[18px] w-[18px]" />
                                )}
                            </button>
                            {!hasToken ? (
                                <Button
                                    type="button"
                                    className="min-h-9 px-4 text-xs sm:text-sm"
                                    onClick={() => navigate("/login")}
                                >
                                    {t("layout.login")}
                                </Button>
                            ) : (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300/90">
                                    {t("layout.loggedInBadge")}
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
                                    `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? navActive : navInactive}`
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
                                className="rounded-lg px-3 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                                {t("layout.logout")}
                            </button>
                        )}
                        <NavLink
                            to="/login"
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-claw-600 dark:hover:text-claw-400"
                        >
                            {hasToken ? t("layout.tokenOrLogin") : t("layout.loginRegister")}
                        </NavLink>
                    </div>
                </div>
            </header>

            <main
                className={`mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pt-4${
                    isChatRoute ? " overflow-hidden" : ""
                }`}
            >
                <div
                    className={
                        isChatRoute
                            ? "flex min-h-0 flex-1 flex-col overflow-hidden pb-0"
                            : "pb-24 sm:pb-8"
                    }
                >
                    <Outlet />
                </div>
            </main>

            <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/90 bg-white/95 pb-safe backdrop-blur-lg dark:border-slate-800/90 dark:bg-slate-950/95 sm:hidden">
                <div className="mx-auto flex max-w-6xl justify-around safe-pb">
                    {nav.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === "/"}
                            className={({ isActive }) =>
                                `flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium ${
                                    isActive
                                        ? "text-claw-700 dark:text-claw-300"
                                        : "text-slate-500 dark:text-slate-500"
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
