/**
 * OneClaw 系统初始化与引导程序
 * 职责：创建数据存储目录、工作区目录，并向控制台输出启动提示
 */

import fs from "fs/promises";
import path from "path";
import { appConfig } from "../config/evn"; // 引入系统路径配置
import { PORT } from "../config/evn";       // 引入端口配置

export async function runOnboard(): Promise<void> {
    console.log("[OneClaw] 正在初始化...");

    // 1. 创建基础数据目录（用于存放数据库、日志等长期数据）
    // { recursive: true } 确保即使上级目录不存在也会一并创建，且目录已存在时不会报错
    await fs.mkdir(appConfig.dataDir, { recursive: true });
    console.log(`  数据目录: ${appConfig.dataDir}`);

    // 2. 创建工作区目录（用于存放临时文件、代码执行环境等）
    await fs.mkdir(appConfig.userWorkspaceDir, { recursive: true });
    console.log(`  Workspace: ${appConfig.userWorkspaceDir}`);

    // 3. 创建工作区目录（用于存放临时文件、代码执行环境等）
    await fs.mkdir(appConfig.skillsDir, { recursive: true });
    console.log(`  Workspace: ${appConfig.skillsDir}`);

    // 4. 检查安全配置：判断是否设置了 WebChat 访问令牌
    const hasToken = !!appConfig.webchatToken;

    // 5. 打印“新手指南”
    console.log("\n[OneClaw] 初始化完成。");
    
    // 提示用户如何正式启动服务
    console.log("  启动 Gateway: pnpm run dev  或  npx tsx src/cli.ts start");
    
    // 提示 Web 端访问地址
    console.log(`  WebChat 地址: http://localhost:${PORT}/`);

    // 5. 根据 Token 配置情况，给出不同的安全提示
    if (hasToken) {
        // 如果配置了 Token，告诉用户请求时需要带上认证信息
        console.log("  访问时请带 token: Authorization: Bearer <WEBCHAT_TOKEN> 或 ?token=<WEBCHAT_TOKEN>");
    } else {
        // 如果没配置，发出安全警告，提示用户当前环境是不设防的
        console.log("  未配置 WEBCHAT_TOKEN，当前为开放访问（建议生产环境在 .env 中设置 WEBCHAT_TOKEN）");
    }
}
