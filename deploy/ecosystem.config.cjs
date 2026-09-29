const fs = require('node:fs');
const { parseEnv } = require('node:util');
const base = process.env.CRM_ROOT || '/opt/crm';
const secrets = parseEnv(fs.readFileSync(`${base}/shared/runtime.env`, 'utf8'));
const common = { autorestart: true, restart_delay: 3000, min_uptime: 10000, max_restarts: 10, time: true, kill_timeout: 30000 };
module.exports = { apps: [
  { ...common, name: 'crm-postgres', script: `${base}/postgres/bin/postgres`, args: ['-D', `${base}/pgdata`], interpreter: 'none', uid: 'crm', gid: 'crm', cwd: base, kill_signal: 'SIGINT', env: { TZ: 'UTC' } },
  { ...common, name: 'crm-minio', script: `${base}/bin/minio`, args: ['server', `${base}/files`, '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001'], interpreter: 'none', uid: 'crm', gid: 'crm', cwd: base, env: { MINIO_ROOT_USER: secrets.MINIO_ACCESS_KEY, MINIO_ROOT_PASSWORD: secrets.MINIO_SECRET_KEY, GOMEMLIMIT: '384MiB', GOMAXPROCS: '2' } },
  { ...common, name: 'crm-web', script: `${base}/app/current/server.js`, interpreter: `${base}/node/bin/node`, uid: 'crm', gid: 'crm', cwd: `${base}/app/current`, env: { ...secrets, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3003', TZ: 'Asia/Shanghai' } },
  { ...common, name: 'crm-nginx', script: `${base}/nginx/sbin/nginx`, args: ['-c', `${base}/shared/nginx.conf`, '-g', 'daemon off;'], interpreter: 'none', cwd: base },
] };
