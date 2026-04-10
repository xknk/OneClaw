export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "oneclaw.theme";

export function isThemePreference(v: string | null | undefined): v is ThemePreference {
    return v === "light" || v === "dark" || v === "system";
}
