import { spawnSync } from 'node:child_process';
const url = new URL(process.env.DATABASE_URL);
const destination = process.argv[2];
if (!destination) throw new Error('Backup destination is required');
const result = spawnSync('pg_dump', ['--format=custom', '--file', destination], { stdio: 'inherit', env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1) } });
if (result.status !== 0) process.exit(result.status || 1);
