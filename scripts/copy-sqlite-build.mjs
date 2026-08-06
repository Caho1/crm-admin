// 将根 node_modules 中针对 Electron ABI 编译的 better-sqlite3 产物
// 拷贝进 Next standalone（standalone 里的模块缺 binding.gyp/src，无法原地 rebuild，
// 但运行只需要 lib/ + build/Release/*.node）。
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules/better-sqlite3/build");
const dest = path.join(root, ".next/standalone/node_modules/better-sqlite3/build");

if (!existsSync(src)) {
  console.error("[copy-sqlite-build] 根目录 better-sqlite3/build 不存在，请先运行 electron-rebuild");
  process.exit(1);
}
if (!existsSync(dest)) {
  console.error("[copy-sqlite-build] standalone 里没有 better-sqlite3，请先运行 npm run build");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-sqlite-build] 已拷贝 Electron ABI 产物到 standalone");
