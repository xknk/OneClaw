import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/locale/LocaleContext";
import type { UiLocale } from "@/locale/types";
import { apiListTasks, getToken } from "@/api/client";
import { Button, Card, Input } from "@/components/ui";
import { useTheme } from "@/theme/ThemeContext";
import type { ThemePreference } from "@/theme/types";
import { IconMonitor, IconMoon, IconSun } from "@/components/icons";

export function SettingsPage() {
    const { webchatTokenRequired, isGuestAllowed, login, logout, hasToken } = useAuth();
    const { locale, setLocale, t } = useLocale();
    const { preference, setPreference } = useTheme();
    const [token, setTokenState] = useState(() => getToken());
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setTokenState(getToken());
    }, [hasToken]);

    const save = () => {
        const tok = token.trim();
        if (!tok) {
            logout();
            setStatus(t("settings.cleared"));
        } else {
            login(tok);
            setStatus(t("settings.saved"));
        }
        setTimeout(() => setStatus(null), 2000);
    };

    const testConn = async () => {
        setError(null);
        setStatus(null);
        try {
            await apiListTasks({ limit: 1 });
            setStatus(t("settings.connOk"));
        } catch (e) {
            setError(e instanceof Error ? e.message : t("settings.error"));
        }
    };

    const onLangChange = (v: UiLocale) => {
        setLocale(v);
    };

    const onThemeChange = (p: ThemePreference) => {
        setPreference(p);
    };

    return (
        <div className="space-y-4">
            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("settings.themeTitle")}</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-500">
                    {t("settings.themeHint")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant={preference === "light" ? "primary" : "secondary"}
                        className="gap-2"
                        onClick={() => onThemeChange("light")}
                    >
                        <IconSun className="h-4 w-4" />
                        {t("settings.themeLight")}
                    </Button>
                    <Button
                        type="button"
                        variant={preference === "dark" ? "primary" : "secondary"}
                        className="gap-2"
                        onClick={() => onThemeChange("dark")}
                    >
                        <IconMoon className="h-4 w-4" />
                        {t("settings.themeDark")}
                    </Button>
                    <Button
                        type="button"
                        variant={preference === "system" ? "primary" : "secondary"}
                        className="gap-2"
                        onClick={() => onThemeChange("system")}
                    >
                        <IconMonitor className="h-4 w-4" />
                        {t("settings.themeSystem")}
                    </Button>
                </div>
            </Card>

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("settings.uiLang")}</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-500">
                    {t("settings.uiLangHint")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant={locale === "zh" ? "primary" : "secondary"}
                        onClick={() => onLangChange("zh")}
                    >
                        {t("settings.langZh")}
                    </Button>
                    <Button
                        type="button"
                        variant={locale === "en" ? "primary" : "secondary"}
                        onClick={() => onLangChange("en")}
                    >
                        {t("settings.langEn")}
                    </Button>
                </div>
            </Card>

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("settings.titleAuth")}</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-500">
                    {t("settings.authIntro")}
                    {webchatTokenRequired ? (
                        <span className="text-amber-800 dark:text-amber-200/90"> {t("settings.tokenRequired")}</span>
                    ) : (
                        <span className="text-emerald-800 dark:text-emerald-200/90"> {t("settings.tokenOpen")}</span>
                    )}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-500">
                    {t("settings.authHint")}
                    <Link to="/login" className="text-claw-600 hover:underline dark:text-claw-400">
                        {" "}
                        {t("layout.login")}
                    </Link>
                    {isGuestAllowed ? ` ${t("settings.guestAllowed")}` : ""}
                </p>
                <label className="mt-4 block text-xs text-slate-600 dark:text-slate-400">
                    {t("settings.tokenLabel")}
                    <Input
                        className="mt-1 font-mono"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setTokenState(e.target.value)}
                        placeholder={t("settings.tokenPlaceholder")}
                    />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={save}>
                        {t("settings.save")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void testConn()}>
                        {t("settings.testConn")}
                    </Button>
                </div>
                {status && <p className="mt-2 text-sm text-claw-700 dark:text-claw-300">{status}</p>}
                {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            </Card>

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("settings.devTitle")}</h2>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600 dark:text-slate-500">
                    <li>{t("settings.dev1")}</li>
                    <li>{t("settings.dev2")}</li>
                </ul>
            </Card>
        </div>
    );
}
