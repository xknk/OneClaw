import { describe, expect, it } from "vitest";
import { ToolPolicyGuard, ToolPolicyError } from "@/tasks/stepToolPolicy";
import type { PlanStep } from "@/tasks/collaborationTypes";

function mkStep(partial: Partial<PlanStep> = {}): PlanStep {
    return {
        index: 0,
        title: "s1",
        intent: "do something",
        allowedTools: ["read_file"],
        status: "pending",
        ...partial,
    };
}

describe("ToolPolicyGuard.validateStepContract", () => {
    it("step 缺失时报 STEP_INVALID", () => {
        expect(() => ToolPolicyGuard.validateStepContract(undefined as unknown as PlanStep)).toThrow(ToolPolicyError);
        try {
            ToolPolicyGuard.validateStepContract(undefined as unknown as PlanStep);
        } catch (e) {
            expect((e as ToolPolicyError).code).toBe("STEP_INVALID");
        }
    });

    it("allowlist 缺失时报 STEP_INVALID", () => {
        try {
            ToolPolicyGuard.validateStepContract(mkStep({ allowedTools: undefined }));
            throw new Error("should not reach");
        } catch (e) {
            expect((e as ToolPolicyError).code).toBe("STEP_INVALID");
        }
    });
    it("allowlist 为空时报 NOT_IN_ALLOWLIST", () => {
        try {
            ToolPolicyGuard.validateStepContract(mkStep({ allowedTools: [] }));
            throw new Error("should not reach");
        } catch (e) {
            expect((e as ToolPolicyError).code).toBe("NOT_IN_ALLOWLIST");
        }
    });
    it("合法 step 通过", () => {
        expect(() => ToolPolicyGuard.validateStepContract(mkStep())).not.toThrow();
    });
});

describe("ToolPolicyGuard.assertToolAccess", () => {
    it("命中 allowlist 通过（大小写/空格容错）", () => {
        const step = mkStep({ allowedTools: [" read_file "] });
        expect(() => ToolPolicyGuard.assertToolAccess(step, "READ_FILE")).not.toThrow();
    });

    it("未命中时报 NOT_IN_ALLOWLIST", () => {
        const step = mkStep({ allowedTools: ["read_file"] });
        expect(() => ToolPolicyGuard.assertToolAccess(step, "apply_patch")).toThrow(ToolPolicyError);
        try {
            ToolPolicyGuard.assertToolAccess(step, "apply_patch");
        } catch (e) {
            expect((e as ToolPolicyError).code).toBe("NOT_IN_ALLOWLIST");
        }
    });

    it("toolName 非法时报 TOOL_INVALID", () => {
        const step = mkStep();
        expect(() => ToolPolicyGuard.assertToolAccess(step, "   ")).toThrow(ToolPolicyError);
        try {
            ToolPolicyGuard.assertToolAccess(step, "   ");
        } catch (e) {
            expect((e as ToolPolicyError).code).toBe("TOOL_INVALID");
        }
    });
});