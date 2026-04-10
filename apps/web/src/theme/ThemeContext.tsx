import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { isThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "./types";

type ResolvedTheme = "light" | "dark";

function readStoredPreference(): ThemePreference {
    try {
        const v = localStorage.getItem(THEME_STORAGE_KEY);
        return isThemePreference(v) ? v : "system";
    } catch {
        return "system";
    }
}

function getSystemDark(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
    if (preference === "light") return "light";
    if (preference === "dark") return "dark";
    return getSystemDark() ? "dark" : "light";
}

type ThemeContextValue = {
    preference: ThemePreference;
    resolved: ResolvedTheme;
    setPreference: (p: ThemePreference) => void;
    /** 在亮色 / 暗色间切换（写入显式 preference，便于与「跟随系统」区分） */
    toggleLightDark: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
    const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredPreference()));

    useEffect(() => {
        const next = resolveTheme(preference);
        setResolved(next);
        const root = document.documentElement;
        if (next === "dark") {
            root.classList.add("dark");
        } else {
            root.classList.remove("dark");
        }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute("content", next === "dark" ? "#0f172a" : "#f8fafc");
        }
    }, [preference]);

    useEffect(() => {
        if (preference !== "system") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => {
            setResolved(resolveTheme("system"));
            const next = resolveTheme("system");
            const root = document.documentElement;
            if (next === "dark") root.classList.add("dark");
            else root.classList.remove("dark");
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) {
                meta.setAttribute("content", next === "dark" ? "#0f172a" : "#f8fafc");
            }
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [preference]);

    const setPreference = useCallback((p: ThemePreference) => {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, p);
        } catch {
            /* ignore */
        }
        setPreferenceState(p);
    }, []);

    const toggleLightDark = useCallback(() => {
        const next = resolved === "dark" ? "light" : "dark";
        setPreference(next);
    }, [resolved, setPreference]);

    const value = useMemo(
        () => ({ preference, resolved, setPreference, toggleLightDark }),
        [preference, resolved, setPreference, toggleLightDark],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error("useTheme must be used within ThemeProvider");
    }
    return ctx;
}
