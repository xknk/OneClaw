import { Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/locale/LocaleContext";

export function ProtectedRoute() {
    const { ready } = useAuth();
    const { t } = useLocale();

    if (!ready) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-100 px-4 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-claw-500 border-t-transparent" />
                <p className="text-sm">{t("protected.connecting")}</p>
            </div>
        );
    }

    return <Outlet />;
}
