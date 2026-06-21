#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/naor/offerops-demo"
SRC="${ROOT}/artifacts/offerops/dist/public"
DEST="/var/www/offerops-demo"

cd "$ROOT"
pnpm --filter @workspace/offerops run build

echo "--- dist string check ---"
grep -o "Today's Focus\|Revenue By Network\|Open Tasks\|Command center" "${SRC}/assets/"*.js | sort | uniq -c

sudo rsync -av --delete "${SRC}/" "${DEST}/"
sudo chown -R www-data:www-data "$DEST"
sudo nginx -t
sudo systemctl reload nginx

echo "--- deployed string check ---"
grep -o "Today's Focus\|Revenue By Network\|Open Tasks\|Command center" "${DEST}/assets/"*.js | sort | uniq -c

curl -I https://demo.offerops.app/ops
curl -I https://demo.offerops.app/operations

ls -lah "${DEST}/index.html"
