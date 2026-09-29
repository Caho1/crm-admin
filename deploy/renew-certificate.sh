#!/usr/bin/env bash
set -Eeuo pipefail
/opt/crm/certbot/bin/certbot renew --quiet --deploy-hook '/opt/crm/nginx/sbin/nginx -t -c /opt/crm/shared/nginx.conf && /opt/crm/nginx/sbin/nginx -s reload -c /opt/crm/shared/nginx.conf'
