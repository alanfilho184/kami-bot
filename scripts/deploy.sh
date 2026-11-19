#!/usr/bin/env bash

set -euEo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
trap 'echo "${BASH_SOURCE:-unknown}:${LINENO:-unknown}: $BASH_COMMAND";' ERR

: "${APP_DIR:?APP_DIR not defined}"
: "${BRANCH:?BRANCH not defined}"
: "${HEALTH_URL:?HEALTH_URL not defined}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

log "cd"
cd "$APP_DIR"

log "pull"
git fetch -q origin $BRANCH
git clean -fd 
git reset --hard origin/$BRANCH

log "npm ci"
npm ci --no-audit --no-fund

log "build"
npm run build

log "prisma migrate deploy"
npx prisma migrate deploy

log "pm2 restart"
pm2 restart ecosystem.config.js

sleep 5

log "healthcheck $HEALTH_URL"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; then
    log "healtcheck ok"
    exit 0
  fi
  sleep 2
done

fail "healthcheck failed after 60s"