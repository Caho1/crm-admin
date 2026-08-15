// 跨平台打包用：拉取 better-sqlite3 官方发布的、匹配当前 Electron ABI 的预编译二进制。
// 在 macOS 上打 Windows 包时，原生模块没法本地交叉编译（要 MSVC），
// 只能下载官方 prebuild 覆盖掉本机编译产物；打完包记得 npm rebuild better-sqlite3 换回来。
//
// 用法：node scripts/fetch-sqlite-prebuild.mjs [platform] [arch]   默认 win32 x64
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2] || "win32";
const arch = process.argv[3] || "x64";
const electronVersion = require(path.join(root, "node_modules/electron/package.json")).version;

const result = spawnSync(
  path.join(root, "node_modules/.bin/prebuild-install"),
  ["--runtime=electron", `--target=${electronVersion}`, `--platform=${platform}`, `--arch=${arch}`],
  { cwd: path.join(root, "node_modules/better-sqlite3"), stdio: "inherit" },
);

if (result.status !== 0) {
  console.error(`[fetch-sqlite-prebuild] 获取 ${platform}-${arch} / electron ${electronVersion} 的预编译二进制失败`);
  process.exit(1);
}
console.log(`[fetch-sqlite-prebuild] 已装入 better-sqlite3 ${platform}-${arch}（electron ${electronVersion}）`);
