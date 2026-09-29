# PostgreSQL / MinIO 部署

CentOS Stream 9 / Linux x64，默认目录 `/opt/crm`。

- PostgreSQL 17.11、MinIO `RELEASE.2025-10-15T17-29-55Z`、Nginx 1.30.5 从固定版本源码编译。
- Node 22.23.3 使用官方运行时，PM2 6.0.14 通过 npm 安装。
- PM2 管理 `crm-postgres`、`crm-minio`、`crm-nginx`、`crm-web`，systemd 只负责开机恢复 PM2。
- PostgreSQL、MinIO、应用只监听 loopback，公网通过 Nginx 的 80 端口访问。
- PM2 由 root 管理，数据库、MinIO 和应用以 `crm` 用户运行。密钥保存在 `shared/runtime.env`（0600），不入仓库。

## 首次安装

将当前仓库放到 `/opt/crm/work`，以 root 执行：

```bash
cd /opt/crm/work
bash deploy/install-runtime.sh
bash deploy/build-services.sh
bash deploy/init-services.sh
```

脚本为 2GB 机器配置 4GB swap；编译器等构建依赖通过系统包管理器安装。

迁移前，旧 SQLite 必须使用 `VACUUM INTO` 取得一致快照。在仅用于演练的 `crm_staging` 上先执行：

```bash
export PATH=/opt/crm/node/bin:/opt/crm/postgres/bin:$PATH
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
node --env-file=/opt/crm/shared/staging.env --import tsx scripts/migrate-sqlite-to-postgres.ts /path/to/snapshot.db
```

迁移脚本拒绝覆盖非空目标库，按外键依赖顺序复制所有表，保留账号密码哈希、记录编号、时间和软删除数据，重置序列。逐字段读取比对；名片、拜访和产品附件上传 MinIO 后下载核对 SHA-256，校验失败则回滚 PostgreSQL。对象按内容哈希寻址，可安全重试。演练用独立 bucket `crm-staging`。

停用旧站写入后取得最终快照，使用 `runtime.env` 迁入正式 `crm`。新站验收前保留旧数据和备份。迁移脚本不在日常发布中执行。

## 日常发布

仓库的 `main` 分支是发布来源。首次执行仓库里的脚本，成功后会安装到固定位置：

```bash
sudo bash /opt/crm/work/publish.sh
# 后续直接运行
sudo /opt/crm/publish.sh
```

脚本取 `origin/main` 的精确提交，创建独立发布目录，安装依赖并运行 lint、类型检查、测试和生产构建；备份 PostgreSQL，再执行幂等建表迁移；在私有 3004 端口启动新构建，检测 PostgreSQL 和 MinIO；通过后切换 `app/current`、重启 `crm-web` 并再次检查。不重启 PostgreSQL 和 MinIO。失败恢复上一应用版本。备份位于 `backups`，历史构建位于 `app/releases`，`REVISION` 保存提交编号。

当前数据库迁移仅添加结构，不删除数据。代码回滚不会自动回滚数据库；未来涉及破坏性 schema 修改时必须单独制定迁移和恢复方案。

```bash
export PATH=/opt/crm/node/bin:$PATH
pm2 status
pm2 logs crm-web --lines 100
curl -f http://127.0.0.1:3003/api/health
```

## 文件与备份

MinIO bucket 私有，应用鉴权后代理下载，数据库只保存对象 key 和元数据。SQLite 桌面模式继续使用原有 BLOB。文件删除/覆盖后暂时保留未引用对象，以免破坏历史备份和并发请求；后续可依据数据库引用和备份保留期离线清理。完整备份需要同时保存 PostgreSQL dump、`files` 目录及受保护的运行环境文件。

IP 模式使用 HTTP，`INSECURE_COOKIE=1` 支持登录；配置域名与 HTTPS 后应移除此设置。
