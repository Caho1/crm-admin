#!/usr/bin/env bash
# One-time initialization after build-services.sh and install-runtime.sh.
set -Eeuo pipefail
export PATH=/opt/crm/node/bin:/opt/crm/postgres/bin:$PATH
umask 077
python3 - <<'PY'
from pathlib import Path
import secrets,os,pwd
p=Path('/opt/crm/shared/runtime.env')
if not p.exists():
 pg=secrets.token_hex(24); ak='crm'+secrets.token_hex(8); sk=secrets.token_hex(32)
 p.write_text(f'DATABASE_URL=postgresql://crm_app:{pg}@127.0.0.1:5432/crm\nMINIO_ENDPOINT=http://127.0.0.1:9000\nMINIO_ACCESS_KEY={ak}\nMINIO_SECRET_KEY={sk}\nMINIO_BUCKET=crm-files\nINSECURE_COOKIE=1\n')
 os.chown(p,pwd.getpwnam('crm').pw_uid,pwd.getpwnam('crm').pw_gid);os.chmod(p,0o600)
 p.with_name('staging.env').write_text(p.read_text().replace(':5432/crm',':5432/crm_staging').replace('MINIO_BUCKET=crm-files','MINIO_BUCKET=crm-staging'))
 os.chmod(p.with_name('staging.env'),0o600)
PY
if [ ! -f /opt/crm/pgdata/PG_VERSION ]; then
  runuser -u crm -- initdb -D /opt/crm/pgdata --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
  cat >> /opt/crm/pgdata/postgresql.conf <<'CONF'
listen_addresses = '127.0.0.1'
unix_socket_directories = '/opt/crm/pgdata'
shared_buffers = '128MB'
max_connections = 40
timezone = 'UTC'
CONF
fi
cp /opt/crm/work/deploy/ecosystem.config.cjs /opt/crm/shared/ecosystem.config.cjs
cp /opt/crm/work/deploy/nginx.conf /opt/crm/shared/nginx.conf
pm2 start /opt/crm/shared/ecosystem.config.cjs --only crm-postgres,crm-minio
for attempt in $(seq 1 30); do pg_isready -h /opt/crm/pgdata >/dev/null && break; sleep 2; done
if ! runuser -u crm -- psql -h /opt/crm/pgdata -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='crm_app'" | grep -q 1; then
# Password is streamed to psql, never passed as a process argument or printed.
python3 - <<'PY' | runuser -u crm -- psql -h /opt/crm/pgdata -d postgres -v ON_ERROR_STOP=1
from urllib.parse import urlparse
from pathlib import Path
s=dict(l.split('=',1) for l in Path('/opt/crm/shared/runtime.env').read_text().splitlines())
p=urlparse(s['DATABASE_URL']).password
print(f"CREATE ROLE crm_app LOGIN PASSWORD '{p}';")
print('CREATE DATABASE crm OWNER crm_app; CREATE DATABASE crm_staging OWNER crm_app;')
PY
fi
pm2 save
pm2 startup systemd -u root --hp /root
