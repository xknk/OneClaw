export type UiLocale = "zh" | "en";

export const LOCALE_STORAGE_KEY = "oneclaw.uiLocale";

export function isUiLocale(v: string | undefined | null): v is UiLocale {
    return v === "zh" || v === "en";
}
