import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useAuth } from "@/auth/AuthContext";
import { translate } from "./messages";
import { isUiLocale, LOCALE_STORAGE_KEY, type UiLocale } from "./types";

type LocaleContextValue = {
    locale: UiLocale;
    setLocale: (l: UiLocale) => void;
    t: (key: string, vars?: Record<string, string>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): UiLocale | null {
    try {
        const v = localStorage.getItem(LOCALE_STORAGE_KEY);
        return isUiLocale(v) ? v : null;
    } catch {
        return null;
    }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
    const { ready, serverUiLocale } = useAuth();
    const [locale, setLocaleState] = useState<UiLocale>(() => readStoredLocale() ?? "zh");

    useEffect(() => {
        const stored = readStoredLocale();
        if (stored) {
            setLocaleState(stored);
            return;
        }
        if (ready) {
            setLocaleState(serverUiLocale);
        }
    }, [ready, serverUiLocale]);

    useEffect(() => {
        document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    }, [locale]);

    const setLocale = useCallback((l: UiLocale) => {
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, l);
        } catch {
            /* ignore */
        }
        setLocaleState(l);
    }, []);

    const t = useCallback(
        (key: string, vars?: Record<string, string>) => translate(locale, key, vars),
        [locale],
    );

    const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
    const ctx = useContext(LocaleContext);
    if (!ctx) {
        throw new Error("useLocale must be used within LocaleProvider");
    }
    return ctx;
}
