import { describe, it, expect } from "vitest";
import {
    checkToolPermission,
    evaluateToolPermission,
    type PolicyContext,
} from "@/security/policy";

function ctx(partial: Partial<PolicyContext> = {}): PolicyContext {
    return {
        channelId: "webchat",
        sessionKey: "main",
        agentId: "main",
        profileId: "webchat_default",
        ...partial,
    };
}

describe("checkToolPermission", () => {
    it("readonly 角色应禁止执行写入(apply_patch)与指令执行(exec)", () => {
        const c = ctx({ profileId: "readonly" });
        expect(checkToolPermission(c, "read_file", { path: "src/a.ts" })).toBeNull();
        expect(checkToolPermission(c, "apply_patch")).toMatch(/禁止写入/);
        expect(checkToolPermission(c, "exec", { command: "npm run build" })).toMatch(/禁止执行/);
    });

    it("webchat_default 角色应根据白名单(allowlist)拒绝非法命令", () => {
        const c = ctx({ profileId: "webchat_default" });
        expect(checkToolPermission(c, "exec", { command: "npm run lint" })).toBeNull();
        expect(checkToolPermission(c, "exec", { command: "rm -rf /" })).toMatch(/allowlist/);
    });

    it("webchat_default 应拒绝含 shell 串联/注入片段的命令（参数级策略）", () => {
        const c = ctx({ profileId: "webchat_default" });
        expect(checkToolPermission(c, "exec", { command: "npm run lint && rm -rf /" })).toMatch(/禁止片段/);
    });

    it("qq_group 渠道角色应禁止写文件与命令执行", () => {
        const c = ctx({ profileId: "qq_group" });
        expect(checkToolPermission(c, "read_file", { path: "src/a.ts" })).toBeNull();
        expect(checkToolPermission(c, "apply_patch")).toMatch(/禁止写入/);
        expect(checkToolPermission(c, "exec", { command: "npm run x" })).toMatch(/禁止执行/);
    });

    it("qq_group 应拒绝读取敏感路径（denylist）", () => {
        const c = ctx({ profileId: "qq_group" });
        expect(checkToolPermission(c, "read_file", { path: ".env" })).toMatch(/denylist/);
    });

    it("search_files 的 glob 不允许 ..", () => {
        const c = ctx({ profileId: "webchat_default" });
        expect(checkToolPermission(c, "search_files", { glob: "**/../x" })).toMatch(/\.\./);
    });
});

describe("evaluateToolPermission", () => {
    it("exec 不在 allowlist -> POLICY_EXEC_ALLOWLIST", () => {
        const c = ctx({ profileId: "webchat_default" });
        const r = evaluateToolPermission(c, "exec", { command: "rm -rf /" });
        expect(r.allow).toBe(false);
        if (!r.allow) expect(r.errorCode).toBe("POLICY_EXEC_ALLOWLIST");
    });

    it("敏感路径 denylist -> POLICY_PATH_DENYLIST", () => {
        const c = ctx({ profileId: "qq_group" });
        const r = evaluateToolPermission(c, "read_file", { path: ".env" });
        expect(r.allow).toBe(false);
        if (!r.allow) expect(r.errorCode).toBe("POLICY_PATH_DENYLIST");
    });

    it("禁止写入 -> POLICY_WRITE_FORBIDDEN", () => {
        const c = ctx({ profileId: "readonly" });
        const r = evaluateToolPermission(c, "apply_patch", { path: "a.ts", content: "x" });
        expect(r.allow).toBe(false);
        if (!r.allow) expect(r.errorCode).toBe("POLICY_WRITE_FORBIDDEN");
    });
});