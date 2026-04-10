import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import {
    apiAuthStatus,
    clearToken,
    getToken,
    setToken as saveToken,
} from "@/api/client";
import { ensureRegistered } from "@/lib/localUser";
import type { UiLocale } from "@/locale/types";

type AuthContextValue = {
    /** 已拉取 /api/auth/status */
    ready: boolean;
    /** 服务端是否配置了 WEBCHAT_TOKEN */
    webchatTokenRequired: boolean;
    /** 服务端 ONECLAW_UI_LOCALE（浏览器未保存偏好时使用） */
    serverUiLocale: UiLocale;
    /** 本地是否存有令牌（有即视为已「登录」并带令牌） */
    hasToken: boolean;
    /** 服务端未配置 WEBCHAT_TOKEN，API 可不带头访问 */
    isGuestAllowed: boolean;
    refreshStatus: () => Promise<void>;
    login: (token: string) => void;
    logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [webchatTokenRequired, setWebchatTokenRequired] = useState(true);
    const [serverUiLocale, setServerUiLocale] = useState<UiLocale>("zh");
    const [tokenVersion, setTokenVersion] = useState(0);

    const refreshStatus = useCallback(async () => {
        try {
            const s = await apiAuthStatus();
            setWebchatTokenRequired(s.webchatTokenRequired);
            setServerUiLocale(s.uiLocale);
        } catch {
            // 不因探测失败阻塞界面：网关未启动或代理异常时按「开放」处理，发消息时再报错
            setWebchatTokenRequired(false);
            setServerUiLocale("zh");
        } finally {
            setReady(true);
        }
    }, []);

    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    const login = useCallback((token: string) => {
        saveToken(token.trim());
        ensureRegistered();
        setTokenVersion((v) => v + 1);
    }, []);

    const logout = useCallback(() => {
        clearToken();
        setTokenVersion((v) => v + 1);
    }, []);

    const value = useMemo(() => {
        const tok = getToken().trim().length > 0;
        return {
            ready,
            webchatTokenRequired,
            serverUiLocale,
            hasToken: tok,
            isGuestAllowed: !webchatTokenRequired,
            refreshStatus,
            login,
            logout,
        };
    }, [
        ready,
        webchatTokenRequired,
        serverUiLocale,
        tokenVersion,
        refreshStatus,
        login,
        logout,
    ]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return ctx;
}
