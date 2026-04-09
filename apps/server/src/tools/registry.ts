import type {
    ToolDefinition,
    ToolExecutionContext,
    ToolProvider
} from "./types";
import type { ProviderHealth } from "./providerHealth";

/**
 * 已解析工具的组合对象
 * 将“工具的元数据定义”与其“背后的执行者”绑定在一起
 */
export interface ResolvedTool {
    definition: ToolDefinition; // 工具的描述信息（名称、参数、风险等级等）
    provider: ToolProvider;     // 真正持有 execute 方法并负责运行该工具的提供者
}

/**
 * 工具注册表中心
 * 负责统一管理、筛选和路由所有的 LLM 工具
 */
export class ToolRegistry {
    // 内部维护一个已注册的提供者列表
    private readonly providers: ToolProvider[] = [];

    /**
     * 注册一个新的工具提供者
     * 每次注册后都会按照 priority（优先级）从大到小重新排序
     */
    register(provider: ToolProvider): void {
        this.providers.push(provider);
        // 降序排列：优先级 10 的 Provider 会排在 5 之前
        this.providers.sort((a, b) => b.priority - a.priority);
    }
    /**
     * 获取当前注册的所有 Provider 列表
     * 常用于调试或监控
     */
    listProviders(): ToolProvider[] {
        return [...this.providers];
    }
    /**
     * 获取当前上下文中所有可用的工具列表
     * 处理逻辑：如果多个 Provider 提供了同名的工具，高优先级的 Provider 胜出
     *   Provider - 工具提供方，如：本地工具
     *   ctx - 工具执行上下文，如：用户、会话等
     *   opts - 可选参数，如：健康状态检查
     * @returns 可用的工具列表
     */
    async listResolved(
        ctx: ToolExecutionContext,
        opts?: { health?: ProviderHealth }
    ): Promise<ResolvedTool[]> {
        // 使用 Map 来去重，Key 是工具名称
        const byName = new Map<string, ResolvedTool>();

        // 遍历所有已排序的 providers
        for (const provider of this.providers) {
            // 检查 Provider 的健康状态, 如果 Provider 处于熔断状态，则跳过
            if (opts?.health?.isOpen(provider.id)) continue;
            let defs: ToolDefinition[];

            // 询问该 Provider：基于当前用户上下文，你有哪些工具可用？
            try {
                defs = await provider.listDefinitions(ctx);
            }
            catch (err) {
                console.error(
                    `[oneclaw] provider ${provider.id} listDefinitions 失败，已跳过:`,
                    err instanceof Error ? err.message : String(err)
                );
                continue;
            }
            for (const def of defs) {
                /**
                 * 冲突解决逻辑：
                 * 因为 providers 已经按优先级排过序，所以先遍历到的 Provider 优先级更高。
                 * 如果 Map 中还没有这个名字的工具，就存入；
                 * 如果已经有了，说明那是更高优先级的 Provider 提供的，直接忽略当前这个。
                 */
                if (!byName.has(def.name)) {
                    byName.set(def.name, { definition: def, provider });
                }
            }
        }

        // 将 Map 转换为数组返回给调用者（如 LLM 编排层）
        return [...byName.values()];
    }

    /**
     * 根据工具名称精确查找某个工具及其关联的 Provider
     * 常用于 LLM 决定调用某个工具时，找到具体的执行逻辑
     */
    async resolveByName(
        name: string,
        ctx: ToolExecutionContext,
        opts?: { health?: ProviderHealth }
    ): Promise<ResolvedTool | null> {
        // 先获取去重并排序后的完整工具列表
        const all = await this.listResolved(ctx, opts);
        // 查找匹配名称的工具，找不到则返回 null
        return all.find((x) => x.definition.name === name) ?? null;
    }
}
