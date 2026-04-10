import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/locale/LocaleContext";
import { Button, Card, Input } from "@/components/ui";

export function LoginPage() {
    const navigate = useNavigate();
    const { ready, hasToken, login, isGuestAllowed } = useAuth();
    const { t } = useLocale();
    const [tokenInput, setTokenInput] = useState("");
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        if (!ready) {
            return;
        }
        if (hasToken) {
            navigate("/", { replace: true });
        }
    }, [ready, hasToken, navigate]);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        const tok = tokenInput.trim();
        if (!tok) {
            setLocalError(t("login.needToken"));
            return;
        }
        login(tok);
        navigate("/", { replace: true });
    };

    const enterAsGuest = () => {
        navigate("/", { replace: true });
    };

    if (!ready) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-claw-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
            <div className="mb-8 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-claw-400 to-teal-700 text-xl font-bold text-white shadow-glow dark:text-slate-950">
                    O
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{t("login.title")}</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-500">{t("login.subtitle")}</p>
                </div>
            </div>

            <Card className="w-full max-w-md p-6">
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-500">{t("login.blurb")}</p>

                {isGuestAllowed ? (
                    <div className="mt-4 space-y-4">
                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                            {t("login.guestOpen")}
                        </p>
                        <Button type="button" className="w-full" onClick={enterAsGuest}>
                            {t("login.enterGuest")}
                        </Button>
                        <form className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" onSubmit={submit}>
                            <label className="block text-xs text-slate-600 dark:text-slate-400">
                                {t("login.saveTokenLabel")}
                                <Input
                                    className="mt-1 font-mono"
                                    type="password"
                                    autoComplete="off"
                                    value={tokenInput}
                                    onChange={(e) => setTokenInput(e.target.value)}
                                    placeholder={t("login.tokenPlaceholderGuest")}
                                />
                            </label>
                            {localError && <p className="text-xs text-rose-400">{localError}</p>}
                            <Button type="submit" className="w-full" disabled={!tokenInput.trim()}>
                                {t("login.submit")}
                            </Button>
                        </form>
                    </div>
                ) : (
                    <form className="mt-4 space-y-4" onSubmit={submit}>
                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{t("login.required")}</p>
                        <label className="block text-xs text-slate-600 dark:text-slate-400">
                            {t("login.tokenLabel")}
                            <Input
                                className="mt-1 font-mono"
                                type="password"
                                autoComplete="off"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder={t("login.tokenPlaceholder")}
                            />
                        </label>
                        {localError && <p className="text-xs text-rose-400">{localError}</p>}
                        <Button type="submit" className="w-full">
                            {t("login.submit")}
                        </Button>
                        <Button type="button" variant="secondary" className="w-full" onClick={enterAsGuest}>
                            {t("login.guestLimited")}
                        </Button>
                    </form>
                )}
            </Card>

            <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-600">
                <Link to="/" className="text-claw-600 hover:underline dark:text-claw-500">
                    {t("login.back")}
                </Link>
            </p>
        </div>
    );
}
