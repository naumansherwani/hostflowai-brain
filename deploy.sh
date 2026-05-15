#!/usr/bin/env bash
# HostFlow AI Brain — Hetzner Deploy Script
# Run this on fresh clone or to redeploy
set -e

echo "=== HostFlow AI Brain — Deploy ==="
echo ""

# ── Check Node version ──────────────────────────────────────────────────────
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required. Install via: curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  exit 1
fi
echo "✅ Node.js $(node --version)"

# ── Check pnpm ──────────────────────────────────────────────────────────────
if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi
echo "✅ pnpm $(pnpm --version)"

# ── Check .env ──────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo ""
  echo "⚠️  No .env file found. Copying .env.example..."
  cp .env.example .env
  echo "📝 Fill in /opt/hostflowai-brain/.env before running the server."
  echo "   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, etc."
  echo ""
fi

# ── Install all workspace dependencies ──────────────────────────────────────
echo ""
echo "--- Installing dependencies..."
pnpm install --frozen-lockfile=false
echo "✅ Dependencies installed"

# ── Build the backend ────────────────────────────────────────────────────────
echo ""
echo "--- Building backend..."
cd backend
node ./build.mjs
cd ..
echo "✅ Build complete → backend/dist/index.mjs"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Deploy complete! ==="
echo ""
echo "To start the server:"
echo "  cd /opt/hostflowai-brain"
echo "  node --enable-source-maps ./backend/dist/index.mjs"
echo ""
echo "To run with PM2 (recommended for production):"
echo "  pm2 start ./backend/dist/index.mjs --name hostflowai-brain --interpreter node"
echo "  pm2 save"
echo "  pm2 startup"
