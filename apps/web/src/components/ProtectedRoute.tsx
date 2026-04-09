import { Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export function ProtectedRoute() {
    const { ready } = useAuth();

    if (!ready) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 px-4 text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-claw-500 border-t-transparent" />
                <p className="text-sm">正在连接网关…</p>
            </div>
        );
    }

    return <Outlet />;
}
