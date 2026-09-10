// 打完 Windows 包之后把 better-sqlite3 换回本机能用的版本。
//
// 跨平台打包时 fetch-sqlite-prebuild.mjs 会把 node_modules 里的 better_sqlite3.node
// 覆盖成 Windows 的 DLL，本机再跑 npm run dev 就会 ERR_DLOPEN_FAILED。
// 打包脚本末尾调用这里重建一次，顺手 require 验证确实能加载。
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

rmSync(path.join(root, "node_modules/better-sqlite3/build"), { recursive: true, force: true });

const rebuild = spawnSync("npm", ["rebuild", "better-sqlite3"], { cwd: root, stdio: "inherit" });
if (rebuild.status !== 0) {
  console.error("[restore-sqlite-dev] 重建失败，本机 npm run dev 会起不来，请手动执行 npm rebuild better-sqlite3");
  process.exit(1);
}

const check = spawnSync(
  process.execPath,
  ["-e", "require('better-sqlite3'); console.log('[restore-sqlite-dev] 本机 better-sqlite3 ABI 正常')"],
  { cwd: root, stdio: "inherit" },
);
process.exit(check.status ?? 1);
