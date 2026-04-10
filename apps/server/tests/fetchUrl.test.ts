import { describe, expect, it } from "vitest";
import { isBlockedFetchHostname } from "@/agent/tools/fetchUrl";

describe("isBlockedFetchHostname", () => {
    it("blocks localhost and private IPv4", () => {
        expect(isBlockedFetchHostname("localhost")).toBe(true);
        expect(isBlockedFetchHostname("127.0.0.1")).toBe(true);
        expect(isBlockedFetchHostname("10.0.0.1")).toBe(true);
        expect(isBlockedFetchHostname("192.168.1.1")).toBe(true);
        expect(isBlockedFetchHostname("172.16.0.1")).toBe(true);
        expect(isBlockedFetchHostname("169.254.169.254")).toBe(true);
    });

    it("allows public hostnames", () => {
        expect(isBlockedFetchHostname("example.com")).toBe(false);
        expect(isBlockedFetchHostname("developer.mozilla.org")).toBe(false);
    });
});
