import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node", // 测试环境
        globals: false, // 全局变量
        include: ["tests/**/*.test.ts"], // 测试文件
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"), // 路径别名
        },
    },
});