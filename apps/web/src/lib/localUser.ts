const PROFILE_KEY = "oneclaw.profile.v1";

export type LocalProfile = {
    userId: string;
    registeredAt: string;
    /** 展示用昵称，可选 */
    displayName?: string;
};

export function getProfile(): LocalProfile | null {
    try {
        const raw = localStorage.getItem(PROFILE_KEY);
        if (!raw) {
            return null;
        }
        return JSON.parse(raw) as LocalProfile;
    } catch {
        return null;
    }
}

/**
 * 首次保存令牌登录时在本机注册身份（无独立账号服务器，仅本地 ID）。
 */
export function ensureRegistered(): LocalProfile {
    const existing = getProfile();
    if (existing) {
        return existing;
    }
    const p: LocalProfile = {
        userId: crypto.randomUUID(),
        registeredAt: new Date().toISOString(),
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    return p;
}

export function updateProfileDisplayName(name: string): void {
    const p = getProfile() ?? ensureRegistered();
    p.displayName = name.trim() || undefined;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}
