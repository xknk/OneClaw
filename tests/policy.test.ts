import { describe, it, expect } from "vitest";
import { checkToolPermission, type PolicyContext } from "@/security/policy";

/**
 * 【测试辅助函数】：ctx (Context 的缩写)
 * 作用：快速创建一个标准的“策略上下文”对象。
 * 技巧：使用 Partial<PolicyContext> 允许我们在测试时只传入想改变的字段（如 profileId），
 * 其余字段自动填充默认值，减少重复代码。
 */
function ctx(partial: Partial<PolicyContext> = {}): PolicyContext {
    return {
        channelId: "webchat",       // 默认渠道：网页聊天
        sessionKey: "main",         // 默认会话
        agentId: "main",           // 默认 Agent
        profileId: "webchat_default", // 默认权限配置 ID
        ...partial,                 // 将传入的覆盖项展开
    };
}

describe("checkToolPermission", () => {

    it("readonly 角色应禁止执行写入(apply_patch)与指令执行(exec)", () => {
        // 创建一个只读权限的上下文
        const c = ctx({ profileId: "readonly" });

        // 1. 验证：只读角色允许执行“读文件”，预期返回 null（表示没有错误，准许通过）
        expect(checkToolPermission(c, "read_file")).toBeNull();

        // 2. 验证：只读角色执行“修改代码”时，预期返回包含“禁止写入”字样的错误字符串
        expect(checkToolPermission(c, "apply_patch")).toMatch(/禁止写入/);

        // 3. 验证：只读角色执行“终端命令”时，预期返回包含“禁止执行”字样的错误字符串
        expect(checkToolPermission(c, "exec", { command: "npm run build" })).toMatch(/禁止执行/);
    });

    it("webchat_default 角色应根据白名单(allowlist)拒绝非法命令", () => {
        // 使用默认权限配置
        const c = ctx({ profileId: "webchat_default" });

        // 1. 验证：执行白名单内的安全命令（如 lint），预期准许通过
        expect(checkToolPermission(c, "exec", { command: "npm run lint" })).toBeNull();

        // 2. 验证：执行危险命令（如删库），预期被拦截并提示不在白名单内 (allowlist)
        expect(checkToolPermission(c, "exec", { command: "rm -rf /" })).toMatch(/allowlist/);
    });

    it("qq_group 渠道角色应禁止写文件与命令执行", () => {
        // 模拟来自 QQ 群渠道的特殊限制逻辑
        const c = ctx({ profileId: "qq_group" });

        // 验证：允许读，但禁止写和运行命令
        expect(checkToolPermission(c, "read_file")).toBeNull();
        expect(checkToolPermission(c, "apply_patch")).toMatch(/禁止写入/);
        expect(checkToolPermission(c, "exec", { command: "npm run x" })).toMatch(/禁止执行/);
    });
});
