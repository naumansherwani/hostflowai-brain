#!/usr/bin/env bash
# HostFlow AI Brain — Hetzner Deploy Script
# Usage: ./deploy.sh
set -e

echo "======================================="
echo " HostFlow AI Brain — Deploy"
echo "======================================="

# 1. Check Node
NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
if [ "$NODE_VER" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required. Current: $(node --version 2>/dev/null)"
  echo "Install: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs"
  exit 1
fi
echo "Node.js $(node --version)"

# 2. Check/install pnpm
if ! command -v pnpm &>/dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm@10
fi
echo "pnpm $(pnpm --version)"

# 3. Check .env
if [ ! -f ".env" ]; then
  echo ""
  echo "WARNING: No .env found. Copying .env.example ..."
  cp .env.example .env
  echo "IMPORTANT: Edit .env with your real values before starting the server."
fi

# 4. Install all workspace deps (run from project root)
echo ""
echo "Installing dependencies..."
pnpm install --no-frozen-lockfile
echo "Dependencies installed."

# 5. Build backend
echo ""
echo "Building backend..."
cd backend
node ./build.mjs
cd ..
echo "Build complete: backend/dist/index.mjs"

# 6. Done
echo ""
echo "======================================="
echo " Deploy complete!"
echo "======================================="
echo ""
echo "Start server:"
echo "  node --enable-source-maps ./backend/dist/index.mjs"
echo ""
echo "Or with PM2:"
echo "  pm2 start ./backend/dist/index.mjs --name hostflowai-brain"
echo "  pm2 save && pm2 startup"
