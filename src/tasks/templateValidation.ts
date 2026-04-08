/**
 * FR-4：模板参数最小校验
 * 作用：在任务输入与模板合并后，执行最后的业务逻辑检查。
 */
import path from "node:path";
import { appConfig } from "@/config/evn"; // 引入全局配置，获取项目根路径
import type { CreateTaskInput } from "./types";

/**
 * 自定义异常类
 * 目的：在全局错误处理中，可以根据错误类型返回 400 (Bad Request)
 */
export class TaskValidationError extends Error {
    override name = "TaskValidationError";
    constructor(message: string) {
        super(message);
    }
}

/**
 * 验证是否为有效非空字符串
 */
function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

/**
 * 安全校验：防止路径穿越攻击 (Path Traversal)
 * 确保所有操作都在指定的 projectRootDir 范围内
 */
function isPathUnderProjectRoot(relativeOrAbsolute: string): boolean {
    // 1. 获取项目标准根路径（绝对路径）
    const root = path.resolve(appConfig.projectRootDir);
    // 2. 将用户输入的路径与根路径结合，解析出最终的绝对路径
    const candidate = path.resolve(root, relativeOrAbsolute.trim());
    // 3. 计算从 root 到 candidate 的相对关系
    const rel = path.relative(root, candidate);
    
    // 如果 rel 以 ".." 开头，说明 candidate 在 root 的上层目录，返回 false
    // 如果 rel 是绝对路径（在某些 OS 环境下），同样返回 false
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 主校验函数
 * @param merged 已经过 mergeCreateInputWithTemplate 处理后的任务数据
 * @throws {TaskValidationError} 校验失败时抛出异常
 */
export function validateMergedTemplateParams(merged: CreateTaskInput): void {
    const tid = merged.templateId?.trim();
    // 如果没有模板 ID，可能是一个通用任务，跳过特定模板校验
    if (!tid) return;

    // 提取参数，若不存在则默认为空对象，防止解构报错
    const params = merged.params ?? {};

    // 根据业务类型进行差异化校验（策略模式思想）
    switch (tid) {
        case "fix_bug": {
            // 校验点 1：必须提供路径
            if (!isNonEmptyString(params.projectPath)) {
                throw new TaskValidationError("模板 fix_bug：params.projectPath 必须为非空字符串");
            }
            // 校验点 2：路径安全性（防止删库等越权操作）
            if (!isPathUnderProjectRoot(String(params.projectPath))) {
                throw new TaskValidationError("模板 fix_bug：projectPath 必须位于项目根目录之下");
            }
            break;
        }

        case "code_review": {
            // 校验点 1：必须提供目标分支
            if (!isNonEmptyString(params.targetBranch)) {
                throw new TaskValidationError("模板 code_review：params.targetBranch 必须为非空字符串");
            }
            // 校验点 2：分支名合法性（防止 shell 注入攻击，如分支名为 "; rm -rf /"）
            const b = String(params.targetBranch).trim();
            if (!/^[a-zA-Z0-9._\-/]+$/.test(b)) {
                throw new TaskValidationError(
                    "模板 code_review：targetBranch 仅允许字母、数字、._-/ 等安全字符"
                );
            }
            break;
        }

        case "daily_report":
        case "release_precheck": {
            // 校验点 1：如果传了风险等级，则必须是规定的枚举值
            if (params.riskLevel !== undefined) {
                const r = String(params.riskLevel).toLowerCase();
                if (!["low", "medium", "high"].includes(r)) {
                    throw new TaskValidationError(`模板 ${tid}：params.riskLevel 须为 low | medium | high`);
                }
            }
            break;
        }

        default:
            // 未定义的模板 ID 默认通过或可在此添加通用校验
            break;
    }
}
