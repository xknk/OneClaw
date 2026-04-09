/**
 * 提供商健康检查配置选项
 */
export interface ProviderHealthOptions {
    failureThreshold?: number;   // 允许的最大连续失败次数，超过后触发熔断
    cooldownMs?: number;         // 熔断触发后的冷却时间（毫秒），即“关小黑屋”的时长
}

/**
 * 内部维护的状态接口
 */
interface State {
    failures: number;            // 当前连续失败的计数
    openUntil: number;           // 熔断结束的时间戳（0 表示当前处于正常闭合状态）
}

/**
 * ProviderHealth 类：实现熔断保护逻辑
 */
export class ProviderHealth {
    private readonly failureThreshold: number;
    private readonly cooldownMs: number;
    // 使用 Map 存储每个 Provider 的健康状况，Key 为 providerId
    private readonly map = new Map<string, State>();

    constructor(opts?: ProviderHealthOptions) {
        // 默认：连续失败 3 次进入熔断，冷却 30 秒
        this.failureThreshold = opts?.failureThreshold ?? 3;
        this.cooldownMs = opts?.cooldownMs ?? 30_000;
    }

    /**
     * 检查指定 Provider 是否处于“熔断开启”状态（即不可用）
     * @returns true 表示熔断中（不可用），false 表示正常（可用）
     */
    isOpen(providerId: string, now = Date.now()): boolean {
        const s = this.map.get(providerId); // 获取指定 Provider 的健康状况
        if (!s) return false;          // 没有记录说明从未失败，可用
        if (s.openUntil <= 0) return false; // openUntil 为 0 说明未进入熔断，可用

        // 检查是否已经过了冷却期
        if (s.openUntil <= now) {
            // 冷却时间已到，自动重置状态，允许尝试调用
            this.map.set(providerId, { failures: 0, openUntil: 0 });
            return false;
        }

        // 仍在冷却期内，返回 true（熔断开启）
        return true;
    }

    /**
     * 当 Provider 调用成功时调用此方法
     * 只要成功一次，就重置该 Provider 的所有失败计数
     */
    onSuccess(providerId: string): void {
        this.map.set(providerId, { failures: 0, openUntil: 0 });
    }

    /**
     * 当 Provider 调用失败时调用此方法
     */
    onFailure(providerId: string, now = Date.now()): void {
        const prev = this.map.get(providerId) ?? { failures: 0, openUntil: 0 };
        const failures = prev.failures + 1; // 失败计数递增

        // 如果连续失败次数达到设定的阈值
        if (failures >= this.failureThreshold) {
            // 开启熔断：记录当前的冷却结束时间点
            this.map.set(providerId, {
                failures,
                openUntil: now + this.cooldownMs,
            });
            return;
        }

        // 尚未达到阈值，仅更新失败计数，不开启熔断
        this.map.set(providerId, { failures, openUntil: 0 });
    }

    /**
     * 获取指定 Provider 的当前状态快照（用于调试或监控）
     */
    snapshot(providerId: string) {
        return this.map.get(providerId) ?? { failures: 0, openUntil: 0 };
    }
}
