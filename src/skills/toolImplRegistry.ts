// src/skills/toolImplRegistry.ts

import type { Skill, SkillToolImpl } from "./types";
import type { Tool } from "@/agent/types";
import { generateDailyReport } from "@/reporting/dailyReportService";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
/**
 * 运行时工具注册表（单例缓存）
 * Key: 工具名称 (如 "generate_daily_report")
 * Value: 符合 Agent 接口要求的 Tool 实例
 */
const runtimeToolMap = new Map<string, Tool>();

/**
 * 本地函数实现映射表
 * 这里存放所有 type 为 'local' 的具体执行逻辑。
 * 每一个 Key 对应 Skill 定义中的 localHandler 标识符。
 */
const localHandlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<string>
> = {
    // 日报生成器的具体实现
    "daily_report.generate": async (args) => {
        // 1. 提取并校验参数（从 AI 识别出的 args 中获取）
        const date = typeof args?.date === "string" ? args.date : undefined;
        const sessionKey = typeof args?.sessionKey === "string" ? args.sessionKey : undefined;
        const agentId = typeof args?.agentId === "string" ? args.agentId : undefined;
        const outputPath = typeof args?.outputPath === "string" ? args.outputPath : undefined;

        // 2. 调用底层 Service 执行业务逻辑
        const result = await generateDailyReport({ date, sessionKey, agentId, outputPath });

        // 3. 将执行结果格式化为字符串，返回给 LLM 阅读
        return [
            "日报生成成功",
            `日期: ${result.date}`,
            `输出路径: ${result.outputPath}`,
            `总调用数: ${result.totalCalls}`,
            `成功数: ${result.successCalls}`,
            `失败数: ${result.failedCalls}`,
            `涉及工具: ${result.uniqueTools}`,
        ].join("\n");
    },
};


async function callHttpTool(
    url: string,
    method: "GET" | "POST",
    args: Record<string, unknown>
): Promise<string> {
    return new Promise((resolve) => {
        try {
            const u = new URL(url); // 解析 URL
            const isHttps = u.protocol === "https:"; // 判断是否是 HTTPS 请求
            const reqFn = isHttps ? httpsRequest : httpRequest; // 选择请求函数

            const body = method === "GET" ? undefined : JSON.stringify(args ?? {}); // 判断是否是 GET 请求
            const req = reqFn( // 发起请求
                {
                    protocol: u.protocol, // 协议
                    hostname: u.hostname,  // 主机名
                    port: u.port || undefined, // 端口
                    path: `${u.pathname}${u.search}`, // 路径
                    method, // 方法
                    headers: {
                        "Content-Type": "application/json",
                        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
                    },
                    timeout: 15_000,
                },
                (res) => {
                    let data = "";  // 响应数据
                    res.on("data", (chunk) => (data += chunk.toString())); // 监听数据
                    res.on("end", () => { // 监听结束
                        const status = res.statusCode ?? 0; // 状态码
                        if (status >= 200 && status < 300) { // 判断是否成功
                            resolve(data || "ok"); // 返回响应数据
                        } else {
                            resolve(`HTTP 工具调用失败: status=${status}, body=${data}`); // 返回错误信息
                        }
                    });
                }
            );

            req.on("timeout", () => {
                req.destroy(new Error("HTTP 请求超时"));
            });

            req.on("error", (err) => {
                resolve(`HTTP 工具调用失败: ${err.message}`);
            });

            if (body) req.write(body);
            req.end();
        } catch (err) {
            resolve(`HTTP 工具调用失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}


/**
 * 将 Skill 的配置定义 转化为 运行时可执行对象
 * @param toolName 工具的唯一标识名
 * @param impl 工具的具体实现配置（包含类型、处理函数名等）
 */
function buildToolFromImpl(toolName: string, impl: SkillToolImpl): Tool | null {
    // 处理本地调用逻辑
    if (impl.type === "local") {
        const fn = localHandlers[impl.localHandler];
        if (!fn) {
            console.warn(`未找到本地处理器: ${impl.localHandler}`);
            return null;
        }

        // 返回一个符合 Agent 调用接口的对象
        return {
            name: toolName,
            description: `Skill local tool: ${impl.localHandler}`, // 这里的描述可以更丰富，帮助 LLM 理解
            async execute(args: Record<string, unknown>) {
                try {
                    // 执行具体函数并捕获可能存在的业务异常
                    return await fn(args);
                } catch (err) {
                    return `工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        };
    } else if (impl.type === "http") {
        // 处理 HTTP 调用逻辑
        const method = impl.method ?? "POST"; // 方法
        return {
            name: toolName,
            description: `Skill http tool: ${impl.url}`, // 描述
            async execute(args: Record<string, unknown>) { // 执行
                return await callHttpTool(impl.url, method, args); // 调用 HTTP 工具
            },
        };
    }
    // 后续可在此扩展 'http' 或 'grpc' 等其他类型的实现
    return null;
}

/**
 * 重建运行时工具库
 * 场景：当用户切换 Agent、更新 Skill 配置或新请求进入时调用。
 * 作用：保证 runtimeToolMap 里的工具与传入的 skills 定义完全同步。
 */
export function rebuildRuntimeSkillTools(skills: Skill[]): void {
    // 清空旧的工具，防止跨请求的状态污染
    runtimeToolMap.clear();

    for (const skill of skills) {
        const impls = skill.toolImpls;
        if (!impls || typeof impls !== "object") continue;

        // 遍历 Skill 中定义的所有工具接口
        for (const [toolName, impl] of Object.entries(impls)) {
            const tool = buildToolFromImpl(toolName, impl);
            if (tool) {
                runtimeToolMap.set(toolName, tool);
            }
        }
    }
}

/**
 * 获取已注册的工具实例
 * Agent 在执行 Plan 时，通过此方法获取工具并运行 execute()
 */
export function getRuntimeSkillTool(name: string): Tool | undefined {
    return runtimeToolMap.get(name);
}
