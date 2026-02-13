#!/bin/sh

echo "=== Container starting at $(date) ==="
echo "PORT=${PORT:-not set}"
echo "NODE_ENV=${NODE_ENV:-not set}"
echo "DATABASE_URL is set: $(if [ -n "$DATABASE_URL" ]; then echo yes; else echo no; fi)"
echo "Working directory: $(pwd)"
echo "Node version: $(node --version)"

echo "=== Checking dist/ ==="
ls dist/index.js 2>&1 || echo "ERROR: dist/index.js not found!"

echo "=== Syncing database schema ==="
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "WARNING: prisma db push had issues, continuing..."

echo "=== Starting server ==="
exec node dist/index.js
