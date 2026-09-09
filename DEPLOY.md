# Web 服务器部署（预览 / 正式环境）

本文档针对「把 Next.js 服务端直接跑在一台 Linux 服务器上」这种部署方式（区别于 `README.md` 里说的 Windows 桌面安装包）。这仓库是**公开仓库**，本文档只记录通用的工程经验；具体某台服务器的 IP、账号、目录这些连接信息不放在这里，见下方「服务器连接信息放哪」。

## 部署策略：本地构建，服务器只跑

**不要在资源紧张的服务器上直接 `npm install && npm run build`。** 踩过的坑：

- `next.config.ts` 里 `output: "standalone"`，`next build` 用的是 Turbopack，构建时内存峰值经常超过 1GB。如果服务器只有 1-2GB 内存又同时跑着别的服务（数据库、其他 Node 应用等），大概率会被内核 OOM killer 杀掉，且现象是「装到一半，某个包的文件缺失」这种容易误判成网络/缓存问题的假象，实际上是进程被 SIGKILL。
- `npm install` 如果带上了 `electron` / `electron-builder` / `@electron/rebuild` 这几个仅打包桌面端才需要的开发依赖，同样会因为下载体积大、`electron-builder` 相关工具链吃内存而更容易触发 OOM。

正确流程：**在本地（内存充足的机器）跑 `npm run build`，只把构建产物传到服务器**，服务器上只需要一个能跑 `node server.js` 的 Node 运行时，不需要装完整开发依赖，也不需要跑 `next build`。

## 打包产物

```bash
npm run build
```

需要上传到服务器的是这三样（`output: "standalone"` 的标准产物）：

```
.next/standalone/     # server.js + 按依赖分析裁剪过的 node_modules
.next/static/         # 要放进 .next/standalone/.next/static
public/               # 要放进 .next/standalone/public
```

打包上传示例：

```bash
mkdir -p /tmp/crm-deploy
cp -R .next/standalone/. /tmp/crm-deploy/
mkdir -p /tmp/crm-deploy/.next
cp -R .next/static /tmp/crm-deploy/.next/static
cp -R public /tmp/crm-deploy/public
tar -czf /tmp/crm-deploy.tar.gz -C /tmp/crm-deploy .
scp -i <你的私钥> /tmp/crm-deploy.tar.gz <user>@<host>:/path/to/
```

## better-sqlite3：原生模块，必须匹配服务器的 CPU 架构 + Node ABI

`better-sqlite3` 编译出来的 `.node` 文件是平台相关的二进制，本地 Mac 编译出来的直接传到 Linux 服务器上**打不开**（`ERR_DLOPEN_FAILED`，或者是 `Mach-O` vs `ELF` 直接不兼容）。即便都是 Linux x64，如果服务器上实际跑这个进程的 Node 版本和你编译时用的 Node 版本 ABI 不一致（`NODE_MODULE_VERSION` 不同——比如 Node 20 是 115，Node 22 是 127），一样会报「compiled against a different Node.js version」。

**排查 ABI 不一致这个坑的关键**：如果服务器上用 pm2 管理进程，先确认 pm2 实际用的是哪个 `node` 可执行文件，不要想当然认为是 `which node` 那个（服务器上可能同时装了好几个 Node 版本）：

```bash
pm2 describe <app-name> | grep -i interpreter
```

确认目标 Node 版本后，在服务器上（不是本地）用**那个具体的 node/npm** 编译一份 `better-sqlite3`，再把编译产物覆盖进部署包：

```bash
# 服务器上，假设目标运行时是 /opt/node22/bin/node
cd <一份能跑 npm install 的源码目录>   # 装依赖需要 g++/make，见下一节
PATH=/opt/node22/bin:$PATH /opt/node22/bin/npm rebuild better-sqlite3

# 编译产物在这里，把它整个目录覆盖进部署包
node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

验证方式（用目标 Node 版本直接 require，不报错就是对的）：

```bash
/opt/node22/bin/node -e "require('./node_modules/better-sqlite3'); console.log('OK')"
```

## 服务器上编译原生模块前置条件

如果服务器上要跑 `npm install` 或 `npm rebuild`（哪怕只是为了单独编译 better-sqlite3），需要：

- C++ 编译器：`yum install -y gcc-c++`（Alibaba Cloud Linux / RHEL 系）或对应发行版的等价包。缺 `g++` 时报错是 `make: g++: Command not found`，容易被误判成别的问题。
- Python：`node-gyp` 项目自带的 gyp 脚本需要 Python 3.8+（用了海象运算符 `:=`）。如果系统默认 `python3` 版本较老（比如 3.6），`node-gyp` 自带的会失败；npm 自带的那份 node-gyp（`npm root -g` 附近）有时能兼容更老的 Python，可以先试 `npm rebuild <pkg>`（走 npm 自带 node-gyp）而不是进包目录手动跑该包本地 devDependency 里的 node-gyp。

## 部署时避免踩到的其他坑

- **不要用 `npm rebuild <pkg>` 来验证/修复一个已经工作的原生模块**：`npm rebuild` 会先清空已有的编译产物再重新编译，如果当时环境缺编译器，会把一个原本能跑的二进制直接删掉且rebuild失败，把好的状态搞坏。想验证一个原生模块能不能用，用 `node -e "require(...)"` 直接测，不要用 `npm rebuild` 当探测手段。
- **`npm install` 前先去掉不需要的重量级 devDependencies**：如果 `package.json` 里混了只有打包桌面端才用的 `electron` 系列依赖，服务器部署用不上，安装前可以先在临时副本的 `package.json` 里删掉这几行再 `npm install`，省内存也省时间。
- **数据库文件必须放在部署目录之外，或者部署时明确跳过**：每次更新代码是「删掉旧的 server.js / .next / node_modules，换上新的」，`data/*.db` 这份运行时数据绝对不能被这个流程覆盖或删除。用 pm2 的话，`DATABASE_URL` 环境变量指向一个固定的绝对路径，不要用相对路径，这样不管代码目录怎么换，数据库文件的位置都不变。
- **备份 SQLite 数据库不能直接 `cp` 主库文件**：这个库开着 WAL 模式，最近的写入都还在 `crm.db-wal` 里没合并回主库，线上实际见过主库只有 4096 字节、`-wal` 有 1MB 的情况——直接 `cp crm.db` 备份到的是个空壳。正确做法是让 SQLite 自己导出一份一致的快照：

  ```bash
  # 用能跑起来的那个 node（原生模块 ABI 要对得上，见上文）
  /opt/node22/bin/node -e "
  const D = require('/path/to/node_modules/better-sqlite3');
  const db = new D('/path/to/data/crm.db', { readonly: true });
  db.exec(\"VACUUM INTO '/path/to/backup-\$(date +%Y%m%d-%H%M).db'\");
  "
  ```

  实在要用文件拷贝，就必须把 `crm.db`、`crm.db-wal`、`crm.db-shm` 三个一起拷，且拷的时候没有写入在进行。**改表结构的那种上线（新增列）之前，一定先做这一步。**
- **macOS 打的 tar 包会带 `._*` 伴生文件**：Mac 上 `tar` 会把扩展属性写成同名的 `._xxx` 文件，解压到 Linux 上时还会刷一堆 `Ignoring unknown extended header keyword 'LIBARCHIVE.xattr...'` 警告。这些文件不影响运行，但会留在部署目录里，解压后顺手清掉：`find <部署目录> -maxdepth 1 -name '._*' -delete`（想从源头避免可以打包时加 `COPYFILE_DISABLE=1`）。
- **上线前先备份旧的产物再覆盖**：`server.js` / `.next` / `node_modules` / `public` 覆盖前整体复制一份带日期后缀的备份目录，出问题能立刻切回去。
- **仓库公开时绝不能提交真实业务数据**：`.gitignore` 里已经排除了 `.env*`（除 `.env.example`）、`/data/*.db`、`*.xlsx`/`*.xls`。往公开仓库推代码前，`git status` 确认这些没有被意外 `git add`。

## pm2 常用操作（如果服务器用 pm2 管理进程）

```bash
pm2 list                              # 看当前有哪些进程、端口、内存
pm2 describe <app-name>               # 看这个进程的 interpreter/cwd/env 等详细配置
pm2 restart <app-name> --update-env   # 换完代码后重启，--update-env 保证读到最新环境变量
pm2 logs <app-name> --lines 50 --nostream   # 看最近日志，排查启动报错
```

## 上线后验证清单

1. 服务器本机 `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/login` 应该是 `200`
2. 走一遍登录 + 一个会触发数据库查询的接口（比如 `/api/dashboard`），确认原生模块真的加载成功，不是只有静态页面能访问
3. 从服务器外部（比如本地 `curl http://<公网IP>:<port>/login`）确认端口对外是通的
4. 浏览器里实际登录看一遍关键页面，不只是看接口返回码

## 服务器连接信息放哪

具体某台服务器的 IP、SSH 私钥路径、用户名、部署目录、pm2 进程名这些，不写进这个公开仓库。放在本地未跟踪的 `DEPLOY.local.md`（已加入 `.gitignore`），或者你自己的密码管理器/运维文档里。
