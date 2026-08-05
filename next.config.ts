import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Electron 打包需要自包含的 server.js + 精简 node_modules，
  // 由主进程以子进程方式拉起（见 electron/main.js）
  output: "standalone",
  // Electron 窗口按 127.0.0.1 加载，而 dev server 默认只信任 localhost，
  // 不放行的话窗口里的热更新（HMR）会被拦掉
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
