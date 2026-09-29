#!/usr/bin/env bash
# Node is the runtime/toolchain; PostgreSQL, MinIO and Nginx are built from source.
set -Eeuo pipefail
NODE_VERSION=22.23.3
mkdir -p /opt/crm/src /opt/crm/bin
cd /opt/crm/src
curl -fL --retry 3 -O "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
curl -fL --retry 3 -O "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
grep " node-v${NODE_VERSION}-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
tar -xf "node-v${NODE_VERSION}-linux-x64.tar.xz"
ln -sfn "/opt/crm/src/node-v${NODE_VERSION}-linux-x64" /opt/crm/node
export PATH=/opt/crm/node/bin:$PATH
npm install -g pm2@6.0.14 --no-audit --no-fund
id crm >/dev/null 2>&1 || useradd -m -s /bin/bash crm
mkdir -p /opt/crm/{app,pgdata,files,logs,shared}
chown crm:crm /opt/crm/{app,pgdata,files,logs,shared}
