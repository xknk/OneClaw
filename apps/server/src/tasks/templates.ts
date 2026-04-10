/**
 * V4 FR-4：任务模板中心
 * 功能：预定义标准工作流，减少模型规划开销，增强操作安全性。
 */
import type { CreateTaskInput } from "./types";
import type { PlanStep } from "./collaborationTypes";
import { META_PLAN_KEY } from "./collaborationTypes";
import { loadDynamicTaskTemplates } from "./dynamicTaskTemplates";

/**
 * 任务模板定义接口
 */
export interface TaskTemplateDefinition {
    id: string;                  // 模板唯一标识（如 'fix_bug'）
    defaultTitle: string;        // 默认任务标题
    defaultParams: Record<string, unknown>; // 默认参数（如：项目路径、分支名）
    planSkeleton?: Omit<PlanStep, "status">[]; // 计划骨架：预设的步骤列表，不含运行时状态
    plannerNote?: string;        // 给 Planner 的指导性说明
}

// --- 预设步骤骨架：针对不同场景的“标准动作” ---

const STEPS_FIX_BUG: Omit<PlanStep, "status">[] = [
    { index: 0, title: "复现与定位", intent: "阅读相关代码与日志，确认复现路径", risk: "low", allowedTools: ["read_file", "search_files"] },
    { index: 1, title: "修复与自测", intent: "最小改动修复并运行相关检查", risk: "high", allowedTools: ["read_file", "search_files", "apply_patch", "exec"] },
    { index: 2, title: "复核材料", intent: "整理变更说明与风险点供 Reviewer", risk: "low", allowedTools: ["read_file"] },
];
const STEPS_CODE_REVIEW: Omit<PlanStep, "status">[] = [
    { index: 0, title: "范围确认", intent: "确认评审范围与基准分支", risk: "low", allowedTools: ["read_file", "search_files"] },
    { index: 1, title: "静态阅读", intent: "按模块阅读 diff/关键路径", risk: "low", allowedTools: ["read_file", "search_files"] },
    { index: 2, title: "结论输出", intent: "输出结构化评审结论（问题/建议/阻塞项）", risk: "low", allowedTools: ["read_file"] },
];
const STEPS_DAILY_REPORT: Omit<PlanStep, "status">[] = [
    { index: 0, title: "收集材料", intent: "拉取当日工具调用与会话摘要", risk: "low", allowedTools: ["read_file", "search_files", "generate_daily_report"] },
    {
        index: 1,
        title: "生成日报",
        intent: "调用日报生成并校对",
        risk: "medium",
        allowedTools: ["generate_daily_report", "read_file"],
        onStepFail: "ask_user",
    },
];
const STEPS_RELEASE_PRECHECK: Omit<PlanStep, "status">[] = [
    { index: 0, title: "构建与静态检查", intent: "运行 lint/build 等门禁", risk: "medium", allowedTools: ["read_file", "exec"] },
    { index: 1, title: "变更与风险回顾", intent: "确认变更集、回滚方式", risk: "high", allowedTools: ["read_file", "search_files"] },
    { index: 2, title: "发布前确认清单", intent: "勾选版本号、配置与环境", risk: "high", allowedTools: ["read_file"] },
];
/**
 * 模板注册表：全局唯一的模板存储字典
 */
export const TASK_TEMPLATE_REGISTRY: Record<string, TaskTemplateDefinition> = {
    fix_bug: {
        id: "fix_bug",
        defaultTitle: "修 Bug（模板）",
        defaultParams: { projectPath: ".", riskLevel: "medium" },
        planSkeleton: STEPS_FIX_BUG,
        plannerNote: "模板 fix_bug：以最小修复为原则，高风险步骤注意审批策略。",
    },
    code_review: {
        id: "code_review",
        defaultTitle: "代码评审（模板）",
        defaultParams: { targetBranch: "main", riskLevel: "low" },
        planSkeleton: STEPS_CODE_REVIEW,
        plannerNote: "模板 code_review：只读与评审，避免未经批准的写入与执行。",
    },
    daily_report: {
        id: "daily_report",
        defaultTitle: "日报生成（模板）",
        defaultParams: { riskLevel: "low" },
        planSkeleton: STEPS_DAILY_REPORT,
        plannerNote: "模板 daily_report：基于工具日志生成日报。",
    },
    release_precheck: {
        id: "release_precheck",
        defaultTitle: "发布前检查（模板）",
        defaultParams: { riskLevel: "high" },
        planSkeleton: STEPS_RELEASE_PRECHECK,
        plannerNote: "模板 release_precheck：高风险步骤可接 pending_approval。",
    },
};

function mergedTemplateRegistry(): Record<string, TaskTemplateDefinition> {
    const dynamic = loadDynamicTaskTemplates();
    return { ...TASK_TEMPLATE_REGISTRY, ...dynamic };
}

/**
 * 获取所有可用模板的简要信息（用于前端下拉列表或模型查询）
 */
export function listTaskTemplateSummaries() {
    return Object.values(mergedTemplateRegistry()).map((t) => ({
        id: t.id,
        defaultTitle: t.defaultTitle,
        defaultParams: t.defaultParams,
    }));
}

/**
 * 根据 ID 获取特定模板详情
 */
export function getTaskTemplate(id: string): TaskTemplateDefinition | undefined {
    return mergedTemplateRegistry()[id.trim()];
}

/**
 * 内部私有函数：将“静态骨架”转化为“动态计划”
 * 为每个步骤添加初始状态 "pending"
 */
function planFromSkeleton(def: TaskTemplateDefinition, createdAt: string) {
    if (!def.planSkeleton?.length) return undefined;
    return {
        version: 1 as const,
        steps: def.planSkeleton.map((s) => ({ ...s, status: "pending" as const })),
        plannerNote: def.plannerNote,
        createdAt,
    };
}

/**
 * 【核心逻辑】合并用户输入与模板配置
 * 优先级：用户手动输入 > 模板预设值
 */
export function mergeCreateInputWithTemplate(input: CreateTaskInput): CreateTaskInput {
    const tid = input.templateId?.trim();
    if (!tid) return input; // 无模板 ID，直接返回原输入

    const def = getTaskTemplate(tid);
    if (!def) return input; // 找不到对应模板，不进行合并

    const createdAt = new Date().toISOString();
    const fromTemplateMeta: Record<string, unknown> = {};
    
    // 从模板生成初始计划，并放入元数据的 v4_plan 中
    const seeded = planFromSkeleton(def, createdAt);
    if (seeded) fromTemplateMeta[META_PLAN_KEY] = seeded;

    return {
        ...input,
        // 1. 标题回退：用户没写标题，就用模板标题
        title: input.title?.trim() ? input.title.trim() : def.defaultTitle,
        // 2. 参数合并：用户传入的 params 覆盖模板默认参数
        params: { ...def.defaultParams, ...(input.params ?? {}) },
        // 3. 元数据合并：模板生成的 v4_plan 可以被用户传入的 meta 覆盖
        meta: { ...fromTemplateMeta, ...(input.meta ?? {}) },
    };
}
