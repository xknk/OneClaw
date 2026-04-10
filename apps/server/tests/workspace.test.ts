import { describe, it, expect } from "vitest";
import path from "path";
import { isPathInsideRoot } from "../src/agent/tools/workspace";

describe("isPathInsideRoot", () => {
    it("treats equal paths as inside", () => {
        const r = path.resolve("/proj");
        expect(isPathInsideRoot(r, r)).toBe(true);
    });

    it("allows child paths", () => {
        const root = path.resolve("/proj");
        const child = path.resolve("/proj/src/a.ts");
        expect(isPathInsideRoot(root, child)).toBe(true);
    });

    it("rejects paths outside (no prefix false positive)", () => {
        const root = path.resolve("/proj");
        const evil = path.resolve("/proj2/file");
        expect(isPathInsideRoot(root, evil)).toBe(false);
    });
});
