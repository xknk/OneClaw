import { describe, it, expect } from "vitest";
import { classifyGitInvocation } from "@/agent/tools/gitWorkspace";

describe("classifyGitInvocation", () => {
    it("treats status/diff/log as read", () => {
        expect(classifyGitInvocation(["status", "--porcelain"])).toBe("read");
        expect(classifyGitInvocation(["diff"])).toBe("read");
        expect(classifyGitInvocation(["log", "-n", "3"])).toBe("read");
    });

    it("treats add/commit/push as write", () => {
        expect(classifyGitInvocation(["add", "."])).toBe("write");
        expect(classifyGitInvocation(["commit", "-m", "x"])).toBe("write");
        expect(classifyGitInvocation(["push"])).toBe("write");
    });

    it("stash list/show vs push", () => {
        expect(classifyGitInvocation(["stash", "list"])).toBe("read");
        expect(classifyGitInvocation(["stash", "show"])).toBe("read");
        expect(classifyGitInvocation(["stash", "push"])).toBe("write");
    });

    it("rejects leading -c etc.", () => {
        expect(classifyGitInvocation(["-c", "core.foo=bar", "status"])).toBe("deny");
    });
});
