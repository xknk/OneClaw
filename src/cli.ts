/**
 * OneClaw CLI 入口文件
 */

import "dotenv/config"; // 1. 优先加载 .env 环境变量，确保后续 appConfig 能读到配置
import { Command } from "commander";
import { runOnboard } from "./cli/onboard";
import { runDoctor } from "./cli/doctor";
import { runStart } from "./cli/start";

const program = new Command(); // 创建一个 Commander 实例

// 配置 CLI 的元数据
program
    .name("oneclaw")                  // 定义工具的名字（用于帮助信息显示）
    .description("OneClaw 本地 AI 助手") // 工具的功能描述
    .version("0.1.0");                // 版本号，用户运行 `oneclaw --version` 时显示

// 注册子命令：onboard
program
    .command("onboard")
    .description("初始化配置与 workspace，并给出启动与访问说明")
    .action(runOnboard); // 当用户输入 `oneclaw onboard` 时，执行此函数

// 注册子命令：doctor
program
    .command("doctor")
    .description("自检 bind/auth/workspace/model 等配置，输出风险与修复建议")
    .action(runDoctor);

// 注册子命令：start
program
    .command("start")
    .description("启动 Gateway（WebChat 服务）")
    .action(runStart);

// 解析命令行参数（这行最重要，不写它程序就没反应）
program.parse();
