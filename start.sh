#!/usr/bin/env bash
# HostFlow AI Brain — Start Server (pre-built dist, no build step needed)
set -e

echo "=== HostFlow AI Brain ==="

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "WARNING: Created .env from template. Edit it with real values first!"
  exit 1
fi

echo "Starting server..."
exec node --enable-source-maps ./backend/dist/index.mjs
