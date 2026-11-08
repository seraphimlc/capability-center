#!/bin/sh
set -eu
cd /app/services/api
i=0
until pnpm exec prisma db push --skip-generate --accept-data-loss; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo "mysql did not become ready"
    exit 1
  fi
  echo "waiting for mysql ($i)"
  sleep 2
done
node dist/seed.js
exec node dist/main.js
