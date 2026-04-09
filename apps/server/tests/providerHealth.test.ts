import { describe, it, expect } from "vitest";
import { ProviderHealth } from "@/tools/providerHealth";

describe("ProviderHealth", () => {
    it("连续失败达到阈值后熔断，冷却后自动恢复", () => {
        const h = new ProviderHealth({ failureThreshold: 2, cooldownMs: 1000 });
        const t0 = 1000;

        h.onFailure("p", t0);
        expect(h.isOpen("p", t0)).toBe(false);

        h.onFailure("p", t0);
        expect(h.isOpen("p", t0)).toBe(true);

        expect(h.isOpen("p", t0 + 999)).toBe(true);
        expect(h.isOpen("p", t0 + 1001)).toBe(false);
    });
});