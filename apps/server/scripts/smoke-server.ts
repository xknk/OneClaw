import { createServer } from "@/server/createServer";

/**
 * 冒烟测试主函数：验证 Express 应用是否能成功初始化并绑定端口。
 * 核心逻辑：创建 -> 监听 -> 触发成功事件 -> 正常关闭。
 */
async function main(): Promise<void> {
    // 1. 初始化 Express 实例
    // 如果中间件配置、路由注册有语法错误，代码会在此处直接崩溃
    const app = createServer();

    // 2. 将异步的服务器启动过程包装成 Promise，以便 CI 环境同步等待结果
    await new Promise<void>((resolve, reject) => {
        /**
         * 3. 开启监听
         * 端口 0：让操作系统分配随机可用端口（极其重要，避免 CI 任务因端口占用而失败）。
         * 地址 127.0.0.1：仅监听本地，确保安全且不触发防火墙警告。
         */
        const server = app.listen(0, "127.0.0.1");

        /**
         * 4. 监听错误事件（使用 once 确保只触发一次）
         * 如果启动过程中发生错误（如环境不支持、端口溢出等），直接 reject 结束测试。
         */
        server.once("error", reject);

        /**
         * 5. 核心修复逻辑：监听 'listening' 事件
         * 只有当服务器确实已经占用了端口并准备好接收请求时，才会触发此事件。
         * 这避免了在服务器还没跑起来时就调用 close() 导致的 ERR_SERVER_NOT_RUNNING 错误。
         */
        server.once("listening", () => {
            // 6. 既然能跑到这里，说明服务器“活”了，冒烟测试目标达成
            // 此时安全地关闭服务器，释放资源
            server.close((err) => {
                if (err) {
                    // 如果关闭时发生意外（极罕见），视作测试失败
                    reject(err);
                } else {
                    // 优雅退出，Promise 完成
                    resolve();
                }
            });
        });
    });
}

/**
 * 7. 执行测试并处理全局结果
 */
main()
    .then(() => {
        // 可选：打印成功日志，让 CI 输出更清晰
        console.log("[smoke] server started and closed successfully.");
    })
    .catch((e) => {
        // 如果上述任何环节出错，打印错误堆栈
        console.error("[smoke] failed:", e);
        // 以非零状态码退出，通知 GitHub Actions 这一步失败，拦截后续部署
        process.exit(1);
    });
