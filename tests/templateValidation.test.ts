import { describe, expect, it } from "vitest";
import { TaskValidationError, validateMergedTemplateParams } from "@/tasks/templateValidation";

describe("validateMergedTemplateParams", () => {
    it("fix_bug 缺少 projectPath 时抛错", () => {
        expect(() =>
            validateMergedTemplateParams({
                templateId: "fix_bug",
                params: {},
            })
        ).toThrow(TaskValidationError);
    });

    it("code_review 缺少 targetBranch 时抛错", () => {
        expect(() =>
            validateMergedTemplateParams({
                templateId: "code_review",
                params: {},
            })
        ).toThrow(TaskValidationError);
    });

    it("daily_report riskLevel 非法时抛错", () => {
        expect(() =>
            validateMergedTemplateParams({
                templateId: "daily_report",
                params: { riskLevel: "x" },
            })
        ).toThrow(TaskValidationError);
    });

    it("fix_bug 合法 projectPath 不抛错", () => {
        expect(() =>
            validateMergedTemplateParams({
                templateId: "fix_bug",
                params: { projectPath: "." },
            })
        ).not.toThrow();
    });

    it("code_review 合法 targetBranch 不抛错", () => {
        expect(() =>
            validateMergedTemplateParams({
                templateId: "code_review",
                params: { targetBranch: "feature/fr-5" },
            })
        ).not.toThrow();
    });

    it("未知模板 ID 透传不抛错", () => {
        expect(() =>
            validateMergedTemplateParams({
                templateId: "unknown_template",
                params: { any: "value" },
            })
        ).not.toThrow();
    });
});
