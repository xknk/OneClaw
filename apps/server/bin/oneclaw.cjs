#!/usr/bin/env node
/**
 * 全局命令入口：在项目根执行 `pnpm link --global` 后可直接运行 `oneclaw`（等价于无参进入 TUI）。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
function resolveTsxCli() {
    const candidates = [
        path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(root, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}
const tsxCli = resolveTsxCli();
const cliTs = path.join(root, "src", "cli.ts");

if (!tsxCli) {
    console.error("[oneclaw] 未找到 tsx。请在仓库根目录执行: pnpm install");
    process.exit(1);
}
if (!fs.existsSync(cliTs)) {
    console.error("[oneclaw] 未找到 src/cli.ts");
    process.exit(1);
}

const forwarded = process.argv.slice(2);
const args =
    forwarded.length === 0
        ? ["tui"]
        : forwarded;

const result = spawnSync(process.execPath, [tsxCli, cliTs, ...args], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
