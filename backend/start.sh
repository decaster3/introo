#!/bin/sh

echo "=== Syncing database schema ==="
npx prisma db push --skip-generate --accept-data-loss || echo "WARNING: prisma db push failed, continuing anyway..."

echo "=== Starting server ==="
exec node dist/index.js
