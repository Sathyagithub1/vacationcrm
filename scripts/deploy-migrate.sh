#!/usr/bin/env bash
# Apply prisma migrations on prod, working around the prisma.config.ts requirement
# Run on gmc-vps: bash /opt/vacaycrm/app/scripts/deploy-migrate.sh
set -euo pipefail

cd /opt/vacaycrm/app

# Extract DATABASE_URL from .env, stripping surrounding quotes
DB_URL=$(grep '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL not found in .env" >&2
  exit 1
fi

# Temporarily move prisma.config.ts (the ephemeral container doesn't have
# the `prisma/config` module that the config file imports)
TS_BACKUP=""
if [[ -f prisma.config.ts ]]; then
  TS_BACKUP=$(mktemp --suffix=.prisma.config.ts)
  mv prisma.config.ts "$TS_BACKUP"
fi

cleanup() {
  if [[ -n "$TS_BACKUP" && -f "$TS_BACKUP" ]]; then
    mv "$TS_BACKUP" prisma.config.ts
  fi
}
trap cleanup EXIT

# Run prisma migrate deploy in an ephemeral node container on the app docker network
docker run --rm \
  --network app_default \
  -e DATABASE_URL="$DB_URL" \
  -v /opt/vacaycrm/app/prisma:/app/prisma \
  -w /app \
  node:20-alpine \
  sh -c 'npx --yes prisma@6.19.3 migrate deploy 2>&1'

echo "✓ Migrations applied"
