import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { apiListTasks, getToken } from "@/api/client";
import { Button, Card, Input } from "@/components/ui";

export function SettingsPage() {
    const { webchatTokenRequired, isGuestAllowed, login, logout, hasToken } = useAuth();
    const [token, setTokenState] = useState(() => getToken());
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setTokenState(getToken());
    }, [hasToken]);

    const save = () => {
        const t = token.trim();
        if (!t) {
            logout();
            setStatus("已清除本地令牌");
        } else {
            login(t);
            setStatus("已保存到本地");
        }
        setTimeout(() => setStatus(null), 2000);
    };

    const testConn = async () => {
        setError(null);
        setStatus(null);
        try {
            await apiListTasks({ limit: 1 });
            setStatus("连接正常（已调用 GET /api/tasks）");
        } catch (e) {
            setError(e instanceof Error ? e.message : "失败");
        }
    };

    return (
        <div className="space-y-4">
            <Card className="p-4">
                <h2 className="text-sm font-semibold text-white">WebChat 鉴权</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    当前网关状态（由{" "}
                    <code className="font-mono text-claw-400">GET /api/auth/status</code> 提供）：
                    {webchatTokenRequired ? (
                        <span className="text-amber-200/90"> 需要令牌（已配置 WEBCHAT_TOKEN）</span>
                    ) : (
                        <span className="text-emerald-200/90"> 开放访问（未配置 WEBCHAT_TOKEN）</span>
                    )}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    若需登录或访客入口，请使用{" "}
                    <Link to="/login" className="text-claw-400 hover:underline">
                        登录页
                    </Link>
                    。请求将携带{" "}
                    <code className="font-mono text-slate-400">Authorization: Bearer …</code>（当填写了令牌时）。
                    {isGuestAllowed ? " 当前服务端允许无令牌访问。" : ""}
                </p>
                <label className="mt-4 block text-xs text-slate-400">
                    Token
                    <Input
                        className="mt-1 font-mono"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setTokenState(e.target.value)}
                        placeholder="与 .env 中 WEBCHAT_TOKEN 一致"
                    />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={save}>
                        保存
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void testConn()}>
                        测试连接
                    </Button>
                </div>
                {status && <p className="mt-2 text-sm text-claw-300">{status}</p>}
                {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
            </Card>

            <Card className="p-4">
                <h2 className="text-sm font-semibold text-white">开发说明</h2>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-500">
                    <li>
                        本地开发：根目录执行 <code className="font-mono text-slate-400">pnpm dev</code>{" "}
                        同时启动 API（默认 3000）与 Vite（5173），代理已指向网关。
                    </li>
                    <li>
                        生产环境：先 <code className="font-mono text-slate-400">pnpm build</code>，再{" "}
                        <code className="font-mono text-slate-400">pnpm start</code>
                        ，由服务端托管 <code className="font-mono text-slate-400">apps/web/dist</code>。
                    </li>
                </ul>
            </Card>
        </div>
    );
}
