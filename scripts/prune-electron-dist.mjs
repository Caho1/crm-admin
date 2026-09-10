// electron-builder 的 afterPack 钩子：从打好的目录里删掉这个应用用不到的大件。
//
// Electron 默认把整个 Chromium 原样带上，对一个内网 CRM 来说有很多是纯浪费。
// 下面每一项都写清了是什么、为什么能删，需要恢复就把对应项从数组里去掉重新打包。
import { readdirSync, rmSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/** 界面只有中 / 英 / 韩三种语言（见 src/lib/i18n.ts），其余 52 个 .pak 是死重量 */
const KEEP_LOCALES = new Set(["zh-CN.pak", "en-US.pak", "ko.pak"]);

/**
 * 明确删掉的文件。目前留空 —— 保守起见不动图形相关的动态库。
 *
 * 曾经删过 dxcompiler.dll / dxil.dll（DirectX 着色器编译器，共约 25MB，
 * 理论上只有 WebGPU 会加载，而本应用的图表走 AntV G2 的 canvas 2D）。
 * 但这台 Mac 上没法实际验证 Windows 的渲染表现，省下的体积也就 8MB 左右，
 * 不值得拿目标机器上「图表画不出来」的风险去换，所以保留。
 */
const DROP_FILES = [];

function sizeOf(target) {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default async function prune(context) {
  const dir = context.appOutDir;
  let saved = 0;

  const localesDir = path.join(dir, "locales");
  if (existsSync(localesDir)) {
    for (const name of readdirSync(localesDir)) {
      if (KEEP_LOCALES.has(name)) continue;
      const file = path.join(localesDir, name);
      saved += sizeOf(file);
      rmSync(file, { force: true });
    }
  }

  for (const name of DROP_FILES) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    saved += sizeOf(file);
    rmSync(file, { force: true });
  }

  console.log(`[prune] 已裁剪 ${mb(saved)}，打包目录现在 ${mb(sizeOf(dir))}`);
}
