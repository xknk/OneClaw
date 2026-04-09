import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button, Card, Input } from "@/components/ui";

export function LoginPage() {
    const navigate = useNavigate();
    const { ready, hasToken, login, isGuestAllowed } = useAuth();
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
        const t = tokenInput.trim();
        if (!t) {
            setLocalError("请输入 WebChat 令牌");
            return;
        }
        login(t);
        navigate("/", { replace: true });
    };

    const enterAsGuest = () => {
        navigate("/", { replace: true });
    };

    if (!ready) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-claw-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-950 px-4 py-12">
            <div className="mb-8 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-claw-400 to-teal-700 text-xl font-bold text-slate-950 shadow-glow">
                    O
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-white">登录 OneClaw</h1>
                    <p className="text-sm text-slate-500">保存令牌即视为登录（首次自动本机注册）</p>
                </div>
            </div>

            <Card className="w-full max-w-md p-6">
                <p className="text-xs leading-relaxed text-slate-500">
                    无独立账号服务器：首次成功保存令牌时，会在本机生成用户 ID 并加密存储令牌，用于任务创建与对话历史。
                </p>

                {isGuestAllowed ? (
                    <div className="mt-4 space-y-4">
                        <p className="text-sm leading-relaxed text-slate-300">
                            当前网关<strong className="text-claw-300">未要求</strong>{" "}
                            <code className="rounded bg-slate-800 px-1 font-mono text-xs">WEBCHAT_TOKEN</code>
                            ，可先以<strong className="text-white">访客</strong>
                            直接对话；登录后可创建任务并保存聊天历史。
                        </p>
                        <Button type="button" className="w-full" onClick={enterAsGuest}>
                            以访客进入（不保存令牌）
                        </Button>
                        <form className="space-y-3 border-t border-slate-800 pt-4" onSubmit={submit}>
                            <label className="block text-xs text-slate-400">
                                登录并自动注册（保存令牌）
                                <Input
                                    className="mt-1 font-mono"
                                    type="password"
                                    autoComplete="off"
                                    value={tokenInput}
                                    onChange={(e) => setTokenInput(e.target.value)}
                                    placeholder="与 .env 中 WEBCHAT_TOKEN 一致（若已启用鉴权）"
                                />
                            </label>
                            {localError && <p className="text-xs text-rose-400">{localError}</p>}
                            <Button type="submit" className="w-full" disabled={!tokenInput.trim()}>
                                登录并注册
                            </Button>
                        </form>
                    </div>
                ) : (
                    <form className="mt-4 space-y-4" onSubmit={submit}>
                        <p className="text-sm leading-relaxed text-slate-300">
                            网关已启用鉴权。请输入与{" "}
                            <code className="rounded bg-slate-800 px-1 font-mono text-xs">WEBCHAT_TOKEN</code>{" "}
                            相同的令牌；首次保存将在本机自动注册。
                        </p>
                        <label className="block text-xs text-slate-400">
                            WebChat 令牌
                            <Input
                                className="mt-1 font-mono"
                                type="password"
                                autoComplete="off"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="Bearer token"
                            />
                        </label>
                        {localError && <p className="text-xs text-rose-400">{localError}</p>}
                        <Button type="submit" className="w-full">
                            登录并注册
                        </Button>
                        <Button type="button" variant="secondary" className="w-full" onClick={enterAsGuest}>
                            先以访客进入（无法创建任务、无历史）
                        </Button>
                    </form>
                )}
            </Card>

            <p className="mt-6 text-center text-xs text-slate-600">
                <Link to="/" className="text-claw-500 hover:underline">
                    返回首页
                </Link>
            </p>
        </div>
    );
}
