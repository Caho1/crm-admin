"use strict";

const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");

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
let logStream = null;
/** 服务进程最近的输出，服务报错时直接显示在窗口里，省得让用户去翻日志文件 */
const logTail = [];
const LOG_TAIL_MAX = 80;

/**
 * 打包后的 Windows 应用是 GUI 进程，没有控制台：
 * 子进程哪怕 stdio: "inherit"，输出也直接进虚空，出问题完全看不到原因。
 * 所以统一落到用户数据目录的 logs/server.log，同时留一份内存尾巴。
 */
function logFilePath() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "server.log");
}

function recordLog(chunk) {
  const text = chunk.toString();
  if (logStream) logStream.write(text);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    logTail.push(line);
    if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  }
}

/**
 * 启动自检：把最容易出问题的两件事先试一遍并记进日志。
 * better-sqlite3 是原生模块，跨平台打包时装的是预编译二进制，
 * 一旦 ABI 或架构不对，表现就是每个碰数据库的请求都 500 —— 而 GUI 进程看不到任何错误。
 * 主进程和服务子进程跑的是同一个 Electron ABI，所以这里 require 成功与否有代表性。
 */
function selfCheck(databaseUrl) {
  const modulePath = path.join(process.resourcesPath, "standalone", "node_modules", "better-sqlite3");
  try {
    const Database = require(modulePath);
    const probe = new Database(databaseUrl);
    probe.pragma("journal_mode = WAL");
    const version = probe.prepare("select sqlite_version() as v").get().v;
    probe.close();
    recordLog(`[selfcheck] better-sqlite3 加载正常，SQLite ${version}，数据库可读写\n`);
  } catch (error) {
    recordLog(`[selfcheck] ✗ better-sqlite3 / 数据库自检失败：\n${error && error.stack ? error.stack : error}\n`);
  }
}

/** 生产模式下由主进程拉起 Next standalone 服务；开发模式复用已在跑的 next dev */
function startServer(databaseUrl) {
  if (isDev) return;
  const serverEntry = path.join(process.resourcesPath, "standalone", "server.js");
  const logFile = logFilePath();
  // 每次启动重开日志，只保留本次运行的内容，排查时不用在历史里翻
  logStream = fs.createWriteStream(logFile, { flags: "w" });
  logStream.write(
    [
      `[crm] ${new Date().toISOString()}`,
      `[crm] app ${app.getVersion()} / electron ${process.versions.electron} / node ${process.versions.node} / abi ${process.versions.modules}`,
      `[crm] platform ${process.platform}-${process.arch}`,
      `[crm] execPath ${process.execPath}`,
      `[crm] server   ${serverEntry}`,
      `[crm] database ${databaseUrl}`,
      "",
    ].join("\n"),
  );

  selfCheck(databaseUrl);

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
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", recordLog);
  serverProcess.stderr.on("data", recordLog);
  serverProcess.on("exit", (code) => {
    recordLog(`[crm] Next 服务进程退出，code=${code}\n`);
  });
}

/**
 * 收掉 Next 服务子进程。
 * 它是以 ELECTRON_RUN_AS_NODE 方式跑的同名 exe，没有窗口：
 * 一旦残留就会占着端口，Windows 上还会让新版安装器一直提示「无法关闭，请手动关闭」。
 * Windows 的 kill() 不管孙进程，这里用 taskkill 连整棵进程树一起收；
 * 退出路径可能走多条，做成幂等的，重复调用无副作用。
 */
function stopServer() {
  const child = serverProcess;
  serverProcess = null;
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    console.error("[crm] 停止 Next 服务失败", error);
  }
}

/**
 * 轮询等待服务可用，避免窗口比服务先就绪导致白屏。
 * 返回 "ok" / "error"（服务在跑但首页 5xx）/ "timeout"（压根没起来）。
 * 5xx 要单独区分出来：这种情况下浏览器只会显示一行 Internal Server Error，
 * 真正的原因在服务进程的日志里，得由主进程把日志端到用户面前。
 */
async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(APP_URL, { redirect: "manual" });
      lastStatus = response.status;
      if (response.status < 500) return "ok";
      // 服务已经能应答但在报错，没必要再等满 60 秒
      return "error";
    } catch {
      // 服务还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return lastStatus >= 500 ? "error" : "timeout";
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/** 起不来时显示的诊断页：把服务日志直接贴在窗口里，用户截个图就能定位问题 */
function diagnosticHtml(reason) {
  const logFile = path.join(app.getPath("userData"), "logs", "server.log");
  const tail = logTail.length ? logTail.join("\n") : "（服务进程没有任何输出）";
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8">
<body style="margin:0;padding:32px;font:14px/1.6 -apple-system,'Segoe UI',sans-serif;color:#344054;background:#f4f6f9">
  <h2 style="margin:0 0 8px;color:#b42318">${escapeHtml(reason)}</h2>
  <p style="margin:0 0 6px">应用版本 ${escapeHtml(app.getVersion())}　Electron ${escapeHtml(process.versions.electron)}　ABI ${escapeHtml(process.versions.modules)}</p>
  <p style="margin:0 0 16px;color:#667085">完整日志：<code style="user-select:all">${escapeHtml(logFile)}</code>（可直接复制这一行路径）</p>
  <pre style="margin:0;padding:16px;max-height:60vh;overflow:auto;border:1px solid #e3e8ef;border-radius:8px;background:#fff;font:12px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap">${escapeHtml(tail)}</pre>
</body>`)}`;
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
  if (ready === "ok") {
    await mainWindow.loadURL(APP_URL);
  } else if (isDev) {
    await mainWindow.loadURL(diagnosticHtml(`无法连接本地服务，请先运行 npm run dev（端口 ${PORT}）`));
  } else {
    await mainWindow.loadURL(
      diagnosticHtml(ready === "error" ? "本地服务启动了，但处理请求时报错" : "本地服务未能启动"),
    );
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
  stopServer();
});

// 正常退出、强制退出、主进程崩溃，都别把 Next 服务留成孤儿进程
app.on("will-quit", stopServer);
process.on("exit", stopServer);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopServer();
    app.exit(0);
  });
}
process.on("uncaughtException", (error) => {
  console.error("[crm] 主进程未捕获异常", error);
  stopServer();
  app.exit(1);
});
