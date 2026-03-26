import type { McpClient, McpToolDescriptor } from "./providers/mcpProvider";

/**
 * 先做 stub，后续再接你真实的 MCP 调用实现（比如 CallMcpTool / descriptor 文件）
 */
export const mcpClientStub: McpClient = {
    async listTools(_server: string): Promise<McpToolDescriptor[]> {
        return []; // 先返回空，接入时再改
    },
    async callTool(_server: string, _toolName: string, _args: Record<string, unknown> | undefined): Promise<string> {
        throw new Error("MCP client not configured");
    },
};