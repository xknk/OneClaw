import path from "node:path";
import { appConfig } from "@/config/evn";

/** 网关数据目录下的统一配置文件夹（MCP、任务模板 JSON 等） */
export function getConfigDir(): string {
    return path.join(appConfig.dataDir, "config");
}

/** 默认 MCP 服务器列表文件（当未设置 ONECLAW_MCP_SERVERS_FILE 时使用） */
export function getDefaultMcpServersFilePath(): string {
    return path.join(getConfigDir(), "mcp-servers.json");
}

/** 用户可编辑的任务模板 JSON（与内置 TS 模板合并；同 id 时覆盖内置） */
export function getTaskTemplatesFilePath(): string {
    return path.join(getConfigDir(), "task-templates.json");
}
