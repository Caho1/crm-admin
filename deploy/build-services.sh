#!/usr/bin/env bash
# Run as root on CentOS Stream 9. Build PostgreSQL and MinIO from pinned sources.
set -Eeuo pipefail
umask 022
PG_VERSION=17.11
MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
dnf -y install gcc gcc-c++ make readline-devel zlib-devel openssl-devel libicu-devel flex bison git pcre2-devel golang perl tar xz
mkdir -p /opt/crm/src /opt/crm/bin
cd /opt/crm/src
if ! swapon --show | grep -q /swapfile; then
  if [ ! -e /swapfile ]; then fallocate -l 4G /swapfile; chmod 600 /swapfile; mkswap /swapfile; fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
test -f "postgresql-${PG_VERSION}.tar.bz2" || curl -fL --retry 3 -O "https://ftp.postgresql.org/pub/source/v${PG_VERSION}/postgresql-${PG_VERSION}.tar.bz2"
curl -fL --retry 3 -O "https://ftp.postgresql.org/pub/source/v${PG_VERSION}/postgresql-${PG_VERSION}.tar.bz2.sha256"
sha256sum -c "postgresql-${PG_VERSION}.tar.bz2.sha256"
tar -xf "postgresql-${PG_VERSION}.tar.bz2"
cd "postgresql-${PG_VERSION}"
./configure --prefix=/opt/crm/postgres --with-openssl
make -j2
make install
cd contrib
make -j2
make install
cd /opt/crm/src
GOMAXPROCS=2 GOFLAGS=-p=2 GOPROXY=https://goproxy.cn,direct GOBIN=/opt/crm/bin go install "github.com/minio/minio@${MINIO_VERSION}"
/opt/crm/postgres/bin/postgres --version
/opt/crm/bin/minio --version

cd /opt/crm/src
NGINX_VERSION=1.30.5
test -f nginx-${NGINX_VERSION}.tar.gz || curl -fL --retry 3 -O https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz
echo "6c20565aa2325cb82216ae804f4a4ff1875179014759a381c42ddc8e11c4906d  nginx-${NGINX_VERSION}.tar.gz" | sha256sum -c -
tar -xf nginx-${NGINX_VERSION}.tar.gz
cd nginx-${NGINX_VERSION}
./configure --prefix=/opt/crm/nginx --with-http_ssl_module
make -j2
make install
