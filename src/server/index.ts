/**
 * 应用入口：加载环境变量并启动 HTTP 服务
 *
 * 必须先加载 dotenv，再导入任何会读取 process.env 的模块（如 config、llm）。
 */
import { createServer } from "./createServer";
import { PORT, appConfig  } from "@/config/evn";

async function main() {
    const app = createServer();
    const host = appConfig.bindHost;
    app.listen(PORT, host,() => {
        console.log(`[OneClaw] 服务已启动 http://${host}:${PORT}`);
    });
}

main().catch((err) => {
    console.error("[OneClaw] 启动失败", err);
    process.exit(1);
});