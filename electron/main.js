"use strict";

const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const isDev = !app.isPackaged;
const PORT = Number(process.env.CRM_PORT || (isDev ? 8003 : 8123));
const APP_URL = `http://127.0.0.1:${PORT}`;

/**
 * 打包后应用目录是只读的，数据库必须落在用户数据目录，
 * 否则首次写入就会失败。这里在启动 Next 之前就定好路径，
 * 服务端的 databasePath() 会直接读取 DATABASE_URL。
 */
function resolveDatabasePath() {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "crm.db");
}

let serverProcess = null;
let mainWindow = null;

/** 生产模式下由主进程拉起 Next standalone 服务；开发模式复用已在跑的 next dev */
function startServer(databaseUrl) {
  if (isDev) return;
  const serverEntry = path.join(process.resourcesPath, "standalone", "server.js");
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      // 让子进程以 Node 身份运行 Electron 二进制
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && !app.isQuiting) {
      console.error(`[crm] Next server exited with code ${code}`);
    }
  });
}

/** 轮询等待服务可用，避免窗口比服务先就绪导致白屏 */
async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(APP_URL, { redirect: "manual" });
      if (response.status > 0) return true;
    } catch {
      // 服务还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#f4f6f9",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 外部链接交给系统浏览器，避免在应用窗口里跳出业务范围
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const ready = await waitForServer();
  if (!ready) {
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;padding:48px;color:#344054">
         <h2>无法连接本地服务</h2>
         <p>${isDev ? "请先运行 <code>npm run dev</code>（端口 " + PORT + "）后再启动 Electron。" : "服务启动失败，请查看日志。"}</p>
         </body>`,
      )}`,
    );
  } else {
    await mainWindow.loadURL(APP_URL);
  }

  mainWindow.show();
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(async () => {
  const databaseUrl = resolveDatabasePath();
  process.env.DATABASE_URL = databaseUrl;
  startServer(databaseUrl);

  // 保留标准编辑快捷键（复制/粘贴/全选），其余菜单精简
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  if (serverProcess) serverProcess.kill();
});
