const fs = require('node:fs');
const { parseEnv } = require('node:util');
const base = process.env.CRM_ROOT || '/opt/crm';
const release = process.env.CRM_STAGE_RELEASE;
if (!release) throw new Error('CRM_STAGE_RELEASE is required');
module.exports = { apps: [{ name: 'crm-stage', script: `${release}/server.js`, cwd: release, interpreter: `${base}/node/bin/node`, uid: 'crm', gid: 'crm', autorestart: false, env: { ...parseEnv(fs.readFileSync(`${base}/shared/runtime.env`, 'utf8')), NODE_ENV: 'production', PORT: '3004', HOSTNAME: '127.0.0.1' } }] };
