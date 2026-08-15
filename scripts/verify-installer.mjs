// 打包后校验产物完整性，并打印目标机器上的核对命令。
//
// NSIS 的「Installer integrity check has failed」是安装包自身 CRC 校验不过，
// 绝大多数是 exe 从这台机器传到 Windows 的途中被截断 / 改写（网盘、微信、U 盘、杀毒软件）。
// 打完包先在本地核一遍 electron-builder 写在 latest.yml 里的 sha512 与体积，
// 再把 SHA256 一并打出来，装之前在 Windows 上比一次就能确定是不是传坏了。
//
// 用法：node scripts/verify-installer.mjs [latest.yml 路径]   默认 release/latest.yml
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(root, process.argv[2] || "release/latest.yml");

if (!existsSync(manifestPath)) {
  console.error(`[verify-installer] 找不到 ${path.relative(root, manifestPath)}，请先执行打包`);
  process.exit(1);
}

/** latest.yml 只有固定几个字段，正则取出即可，不引第三方 YAML 解析 */
function parseManifest(text) {
  const entries = [];
  const blocks = text.split(/^\s*-\s+url:\s*/m).slice(1);
  for (const block of blocks) {
    const url = block.split(/\r?\n/)[0].trim();
    const sha512 = /sha512:\s*(\S+)/.exec(block)?.[1];
    const size = /size:\s*(\d+)/.exec(block)?.[1];
    if (url && sha512 && size) entries.push({ url, sha512, size: Number(size) });
  }
  return entries;
}

/**
 * latest.yml 里的 url 是 URL 形式（空格写成 -），磁盘上的文件名带空格：
 * 先按原名找，再把空格与连字符归一后比对，最后按同体积兜底。
 */
function resolveFile(dir, entry) {
  const normalize = (name) => name.replace(/[\s-]+/g, "-").toLowerCase();
  for (const name of [entry.url, decodeURIComponent(entry.url)]) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  const target = normalize(decodeURIComponent(entry.url));
  const names = readdirSync(dir);
  const byName = names.find((name) => normalize(name) === target);
  if (byName) return path.join(dir, byName);
  const bySize = names
    .filter((name) => name.toLowerCase().endsWith(path.extname(entry.url).toLowerCase()))
    .map((name) => path.join(dir, name))
    .find((file) => statSync(file).size === entry.size);
  return bySize || null;
}

function digest(file, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest(encoding)));
  });
}

const dir = path.dirname(manifestPath);
const entries = parseManifest(readFileSync(manifestPath, "utf8"));
if (!entries.length) {
  console.error(`[verify-installer] ${path.relative(root, manifestPath)} 里没有解析到产物条目`);
  process.exit(1);
}

let failed = false;
for (const entry of entries) {
  const file = resolveFile(dir, entry);
  if (!file) {
    console.error(`[verify-installer] ✗ 找不到产物文件：${entry.url}`);
    failed = true;
    continue;
  }
  const name = path.basename(file);
  const size = statSync(file).size;
  if (size !== entry.size) {
    console.error(`[verify-installer] ✗ ${name} 体积不符：磁盘 ${size} 字节，清单 ${entry.size} 字节（打包被中断或磁盘写满）`);
    failed = true;
    continue;
  }
  const sha512 = await digest(file, "sha512", "base64");
  if (sha512 !== entry.sha512) {
    console.error(`[verify-installer] ✗ ${name} 校验和不符，产物已损坏，请重新打包`);
    failed = true;
    continue;
  }
  const sha256 = await digest(file, "sha256", "hex");
  console.log(`[verify-installer] ✓ ${name}（${(size / 1024 / 1024).toFixed(1)} MB）本地校验通过`);
  console.log(`                   SHA256 ${sha256}`);
  console.log(`                   传到 Windows 后先在该机器上核对，一致再安装：`);
  console.log(`                   certutil -hashfile "${name}" SHA256`);
}

if (failed) process.exit(1);
