#!/usr/bin/env bash
# HostFlow AI Brain — Deploy (uses pre-built dist from GitHub)
# NO pnpm, NO npm install, NO build step needed
set -e

echo "=== HostFlow AI Brain — Deploy ==="

# Pull latest
git pull origin main

# Check .env
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "IMPORTANT: Edit /opt/hostflowai-brain/.env with your real values."
  echo "Then run: ./start.sh"
  exit 0
fi

echo "Starting server..."
exec node --enable-source-maps ./backend/dist/index.mjs
