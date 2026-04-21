import { describe, it, expect } from "vitest";
import { parseRiskApprovalIntent } from "@/session/riskApprovalIntent";

describe("parseRiskApprovalIntent", () => {
    const none = { sessionRiskPending: false, taskRiskPending: false };
    const session = { sessionRiskPending: true, taskRiskPending: false };
    const task = { sessionRiskPending: false, taskRiskPending: true };

    it("无待审批时不解析自然语言", () => {
        expect(parseRiskApprovalIntent("批准", none)).toBe(null);
        expect(parseRiskApprovalIntent("同意", none)).toBe(null);
    });

    it("会话待审批：常见短句为批准", () => {
        expect(parseRiskApprovalIntent("批准", session)).toBe("approve");
        expect(parseRiskApprovalIntent("同意", session)).toBe("approve");
        expect(parseRiskApprovalIntent("好", session)).toBe("approve");
        expect(parseRiskApprovalIntent("好的", session)).toBe("approve");
        expect(parseRiskApprovalIntent("ok", session)).toBe("approve");
        expect(parseRiskApprovalIntent("/approve-risk", session)).toBe("approve");
    });

    it("会话待审批：拒绝", () => {
        expect(parseRiskApprovalIntent("拒绝", session)).toBe("reject");
        expect(parseRiskApprovalIntent("不同意", session)).toBe("reject");
    });

    it("无待审批时 /approve-risk 不为批准", () => {
        expect(parseRiskApprovalIntent("/approve-risk", none)).toBe(null);
    });

    it("任务待审批：/task-approve", () => {
        expect(parseRiskApprovalIntent("/task-approve", task)).toBe("approve");
        expect(parseRiskApprovalIntent("/task-approve", none)).toBe(null);
    });
});
