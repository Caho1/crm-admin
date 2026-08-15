# 客户管理系统

面向 10-20 人销售团队的轻量后台，使用 Next.js、Ant Design 和 SQLite 构建。

## 已实现模块

- 工作台：客户、拜访、商机、订单、待出货和到港提醒。
- 客户管理：负责人、协作人、联系人和客户 360 详情。
- 拜访报告：报告编号、参与人、沟通纪要、后续事项和关联产品。
- 项目机会：产品、阶段、预计数量/金额、下一步动作和跟进日期。
- 产品型号/牌号：产品大类与 Grade 独立维护。
- 订单/出货/到港：贸易、付款、船期、实际出货、预计到港、合同和发票。
- 导入导出：订单 Excel 模板、预检、导入和按权限导出。
- 用户权限：管理员/普通用户、账号启停、重置密码和数据交接。
- 审计日志：记录登录、写入、删除、导入和交接操作。

## 本地启动

```bash
npm install
npm run dev
```

浏览器访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)。首次启动会自动创建 `data/crm.db` 并写入演示数据。

## 演示账号

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | `admin` | `Admin@123` |
| 普通用户 | `sales` | `Sales@123` |
| 普通用户 | `kim` | `Sales@123` |

部署前必须修改所有演示密码。

## 常用命令

```bash
npm run db:setup
npm run lint
npm run build
npm start
```

## 打包 Windows 安装包

```bash
npm run electron:pack:win
```

产物在 `release/`。打包末尾会自动跑 `scripts/verify-installer.mjs`，比对 `latest.yml` 里的体积与 sha512，并打印安装包的 SHA256。

把 exe 传到 Windows（网盘 / 微信 / U 盘都可能截断文件）后，**装之前先在那台机器上核一次**，与打包时打印的值一致再双击安装：

```bash
certutil -hashfile "CRM-Admin Setup 0.2.0.exe" SHA256
```

对不上就是传输过程中损坏，重新传一次即可 —— 安装器报 `Installer integrity check has failed` 就是这个原因。已单独拿到的安装包也可以随时用 `npm run verify:installer` 复核。

安装 / 卸载开始前，`build/installer.nsh` 会按进程名结束正在运行的应用（含以 node 模式跑 Next 服务的同名子进程），结束不掉时提示手动退出后重试，避免带着占用安装。

可复制 `.env.example` 配置数据库路径和会话有效天数。SQLite 适合当前小团队规模，正式环境应部署在带持久磁盘的单实例服务器，并定期备份数据库文件。
