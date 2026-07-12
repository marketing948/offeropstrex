#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/naor/offerops"
SRC="${ROOT}/artifacts/offerops/dist/public"
DEST="/var/www/offerops"
BACKUP_DIR="/var/www/offerops-backups"

cd "$ROOT"
pnpm --filter @workspace/offerops run build

BUILD_BUNDLE="$(grep -o 'index-[^"]*.js' "${SRC}/index.html")"
echo "BUILD_BUNDLE=${BUILD_BUNDLE}"

sudo mkdir -p "${BACKUP_DIR}"
sudo tar -czf "${BACKUP_DIR}/offerops-before-daily-mission-v6-$(date +%Y%m%d_%H%M%S).tar.gz" -C /var/www offerops

sudo rsync -av --delete "${SRC}/" "${DEST}/"
sudo chown -R www-data:www-data "${DEST}"
sudo nginx -t
sudo systemctl reload nginx

LIVE_BUNDLE="$(grep -o 'index-[^"]*.js' "${DEST}/index.html")"
echo "LIVE_BUNDLE=${LIVE_BUNDLE}"
test "${BUILD_BUNDLE}" = "${LIVE_BUNDLE}" && echo "bundle match"

curl -I https://offerops.app/tasks
curl -I https://offerops.app/reports
curl -I https://offerops.app/api/healthz
