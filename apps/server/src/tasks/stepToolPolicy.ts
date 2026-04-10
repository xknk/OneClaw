import type { PlanStep } from "./collaborationTypes";

/**
 * 策略错误码：定义拦截的原因
 * - STEP_INVALID: 步骤对象本身结构有问题（如缺少 ID、标题等）
 * - TOOL_INVALID: 调用请求有问题（如工具名传了空字符串）
 * - NOT_IN_ALLOWLIST: 安全拦截（该工具不在当前步骤的允许名单内）
 */
export type ToolPolicyErrorCode =

    | "STEP_INVALID"
    | "TOOL_INVALID"
    | "NOT_IN_ALLOWLIST";

/**
 * 自定义错误类：携带丰富的错误上下文
 * 方便在上层捕获后，能明确知道是哪一步 (stepIndex) 的哪个工具 (toolName) 出错了
 */
export class ToolPolicyError extends Error {
    readonly code: ToolPolicyErrorCode;
    readonly stepIndex?: number;
    readonly toolName?: string;

    constructor(
        code: ToolPolicyErrorCode,
        message: string,
        extras?: { stepIndex?: number; toolName?: string }
    ) {
        super(message);
        this.name = "ToolPolicyError";
        this.code = code;
        this.stepIndex = extras?.stepIndex;
        this.toolName = extras?.toolName;
    }
}

/**
 * 安全守卫类：包含静态预检和动态拦截逻辑
 */
export class ToolPolicyGuard {
    /**
     * 内部标准化工具
     * 消除空格并转小写，防止 "Read_File" 和 "read_file" 匹配失败
     */
    private static normalize(v: string): string {
        return v.trim().toLowerCase();
    }

    /**
     * 【第一道防线：Runner 预检】
     * 场景：在任务正式开始跑之前，对整个 Plan 进行全量体检。
     * 作用：确保每一个步骤的“合同”是完整的，避免跑中途才发现配置错误。
     */
    static validateStepContract(step: unknown): asserts step is PlanStep {
        // 1. 基础存在性校验
        if (!step || typeof step !== "object") {
            throw new ToolPolicyError("STEP_INVALID", "step 对象缺失或非法");
        }
        const s = step as Record<string, unknown>;

        // 2. 索引校验：必须有非负整数索引，用于定位
        if (typeof s.index !== "number" || s.index < 0 || !Number.isFinite(s.index)) {
            throw new ToolPolicyError("STEP_INVALID", "step.index 非法");
        }

        // 3. 元数据校验：必须有标题和意图，保证任务的可观测性和可解释性
        if (typeof s.title !== "string" || !s.title.trim()) {
            throw new ToolPolicyError("STEP_INVALID", "step.title 缺失或为空", {
                stepIndex: s.index as number,
            });
        }
        if (typeof s.intent !== "string" || !s.intent.trim()) {
            throw new ToolPolicyError("STEP_INVALID", "step.intent 缺失或为空", {
                stepIndex: s.index as number,
            });
        }

        // 4. 白名单基础校验：必须定义了允许工具列表
        if (!Array.isArray(s.allowedTools)) {
            throw new ToolPolicyError("STEP_INVALID", "allowedTools 未定义", {
                stepIndex: s.index as number,
            });
        }

        // 5. Fail-Closed 策略：如果一个步骤没配任何工具，该步骤配置无效，直接阻断
        if (s.allowedTools.length === 0) {
            throw new ToolPolicyError("NOT_IN_ALLOWLIST", "allowedTools 为空（fail-closed）", {
                stepIndex: s.index as number,
            });
        }

        const failStrat = s.onStepFail;
        if (failStrat !== undefined && failStrat !== "fail_task" && failStrat !== "ask_user" && failStrat !== "goto_step") {
            throw new ToolPolicyError("STEP_INVALID", "onStepFail 必须是 fail_task | ask_user | goto_step", {
                stepIndex: s.index as number,
            });
        }
        if (failStrat === "goto_step") {
            const gi = s.onFailGotoStepIndex;
            if (typeof gi !== "number" || !Number.isFinite(gi) || gi < 0) {
                throw new ToolPolicyError("STEP_INVALID", "onStepFail=goto_step 时必须提供非负整数 onFailGotoStepIndex", {
                    stepIndex: s.index as number,
                });
            }
        }
    }

    /**
     * 【第二道防线：Executor 硬闸门】
     * 场景：AI 决定调用某个工具时，在真正执行底层代码前进行拦截。
     * 作用：实时阻止 AI 尝试越权调用未授权工具的行为。
     */
    static assertToolAccess(planStep: PlanStep, toolName: string): void {
        // 1. 拦截空调用
        if (!toolName || !toolName.trim()) {
            throw new ToolPolicyError("TOOL_INVALID", "工具名为空", {
                stepIndex: planStep.index,
            });
        }

        // 2. 准备白名单
        const allowlist = Array.isArray(planStep.allowedTools) ? planStep.allowedTools : [];

        // 再次确认名单不为空（冗余防御）
        if (allowlist.length === 0) {
            throw new ToolPolicyError("NOT_IN_ALLOWLIST", "步骤未允许任何工具（fail-closed）", {
                stepIndex: planStep.index,
                toolName, // 审计：保留原始输入的工具名
            });
        }

        // 3. 匹配逻辑
        const req = this.normalize(toolName);
        const ok = allowlist.some((x) => typeof x === "string" && this.normalize(x) === req);

        // 4. 越权拦截：如果不在名单内，直接抛错，终止该步骤执行
        if (!ok) {
            throw new ToolPolicyError(
                "NOT_IN_ALLOWLIST",
                `工具 "${toolName}" 不在步骤允许列表中`, // 消息中保留原始输入以便排查
                { stepIndex: planStep.index, toolName }
            );
        }
    }
}
