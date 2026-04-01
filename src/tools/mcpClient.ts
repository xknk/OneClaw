import type { McpClient, McpToolDescriptor } from "./providers/mcpProvider";

/** 占位用；真实 stdio 接入见 mcpRegistry + RoutingMcpSdkClient */

export const mcpClientStub: McpClient = {
    async listTools(_server: string): Promise<McpToolDescriptor[]> {
        return []; // 先返回空，接入时再改
    },
    async callTool(_server: string, _toolName: string, _args: Record<string, unknown> | undefined): Promise<string> {
        throw new Error("MCP client not configured");
    },
};