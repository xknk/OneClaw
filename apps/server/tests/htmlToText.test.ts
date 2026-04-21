import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "@/agent/tools/htmlToText";

describe("htmlToPlainText", () => {
    it("strips tags and script", () => {
        const h = "<html><script>x</script><body><p>a</p><b>b</b></body></html>";
        expect(htmlToPlainText(h)).toMatch(/a/);
        expect(htmlToPlainText(h)).toMatch(/b/);
        expect(htmlToPlainText(h)).not.toContain("script");
    });
});
