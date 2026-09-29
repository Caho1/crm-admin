#!/usr/bin/env bash
# Server entrypoint: sudo /opt/crm/publish.sh
# Builds origin/main into a fresh release, then switches only the CRM web process.
set -Eeuo pipefail
umask 027
CRM_ROOT=${CRM_ROOT:-/opt/crm}
export CRM_ROOT
export PATH="$CRM_ROOT/node/bin:$CRM_ROOT/postgres/bin:$PATH"
REPOSITORY=${CRM_REPOSITORY:-https://github.com/Caho1/crm-admin.git}
APP="$CRM_ROOT/app"
ENV_FILE="$CRM_ROOT/shared/runtime.env"
[[ $(id -u) == 0 ]] || { echo 'Run as root (sudo).'; exit 1; }
[[ -s "$ENV_FILE" ]] || { echo 'Missing shared/runtime.env'; exit 1; }
mkdir -p "$APP/releases" "$CRM_ROOT/backups"
chmod 755 "$APP/releases"
exec 9>"$APP/publish.lock"
flock -n 9 || { echo 'Another publish is running'; exit 1; }
if [[ ! -d "$APP/repository.git" ]]; then git clone --mirror "$REPOSITORY" "$APP/repository.git"; fi
git --git-dir="$APP/repository.git" fetch --prune origin '+refs/heads/main:refs/heads/main'
REVISION=$(git --git-dir="$APP/repository.git" rev-parse refs/heads/main)
RELEASE="$APP/releases/$(date -u +%Y%m%dT%H%M%SZ)-${REVISION:0:12}"
PREVIOUS=""
if [[ -f "$APP/current/server.js" ]]; then PREVIOUS=$(readlink -f "$APP/current"); fi
SWITCHED=0
cleanup() {
  status=$?
  pm2 delete crm-stage >/dev/null 2>&1 || true
  if [[ $status != 0 && $SWITCHED == 1 ]]; then
    if [[ -n "$PREVIOUS" && -f "$PREVIOUS/server.js" ]]; then
      ln -sfn "$PREVIOUS" "$APP/current.rollback"
      mv -Tf "$APP/current.rollback" "$APP/current"
      pm2 startOrRestart "$PREVIOUS/deploy/ecosystem.config.cjs" --only crm-web --update-env
      pm2 save
      echo "Startup failed; restored $PREVIOUS"
    else
      pm2 delete crm-web >/dev/null 2>&1 || true
      echo 'First deployment failed; no previous release exists.'
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
mkdir -p "$RELEASE/source"
git --git-dir="$APP/repository.git" archive "$REVISION" | tar -x -C "$RELEASE/source"
printf '%s\n' "$REVISION" > "$RELEASE/REVISION"
cd "$RELEASE/source"
# Electron is not needed on a web server. Keep dev dependencies for Next/TypeScript.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
npm run lint
npx tsc --noEmit
npm run test
# Build without touching the live database or loading production credentials.
DATABASE_URL="$RELEASE/build.db" NODE_OPTIONS=--max-old-space-size=1536 npm run build
cp -a .next/standalone/. "$RELEASE/"
cp -a .next/static "$RELEASE/.next/static"
if [[ -d public ]]; then cp -a public "$RELEASE/public"; fi
cp -a deploy "$RELEASE/deploy"
# Snapshot before additive schema migrations. Runtime secrets never enter artifacts.
node --env-file="$ENV_FILE" scripts/backup-postgres.mjs "$CRM_ROOT/backups/$(basename "$RELEASE").dump"
node --env-file="$ENV_FILE" --import tsx scripts/migrate-postgres.ts
chown -R crm:crm "$RELEASE"
# Smoke-test the actual artifact against PostgreSQL and MinIO on a private port.
pm2 delete crm-stage >/dev/null 2>&1 || true
CRM_STAGE_RELEASE="$RELEASE" pm2 start deploy/stage.config.cjs
for attempt in $(seq 1 45); do
  if curl -fsS --max-time 5 http://127.0.0.1:3004/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 10 http://127.0.0.1:3004/api/health >/dev/null
pm2 delete crm-stage
ln -sfn "$RELEASE" "$APP/current.next"
mv -Tf "$APP/current.next" "$APP/current"
SWITCHED=1
pm2 startOrRestart "$RELEASE/deploy/ecosystem.config.cjs" --only crm-web --update-env
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:3003/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 10 http://127.0.0.1:3003/api/health >/dev/null
pm2 save
# Next invocation uses the deployment logic from this verified release.
install -m 750 "$RELEASE/source/publish.sh" "$CRM_ROOT/publish.sh"
echo "Published main at $REVISION; previous release: $PREVIOUS"
