# HostFlow AI Brain

Backend API server for HostFlow AI — 8-industry AI automation OS.

## Stack
- Node.js 20+ · TypeScript 5.9
- Express 5
- PostgreSQL + Drizzle ORM
- GPT-5 compatible (OpenAI API format)
- ElevenLabs (voice advisors)
- Resend (email)
- Polar.sh (payments)

---

## Hetzner Deployment (Step by Step)

### 1. Clone
```bash
git clone https://github.com/naumansherwani/hostflowai-brain.git /opt/hostflowai-brain
cd /opt/hostflowai-brain
```

### 2. Environment variables
```bash
cp .env.example .env
nano .env   # Fill in all values
```

### 3. Install + Build (ONE COMMAND)
```bash
chmod +x deploy.sh
./deploy.sh
```

### 4. Run
```bash
# Direct
node --enable-source-maps ./backend/dist/index.mjs

# With PM2 (recommended for production)
pm2 start ./backend/dist/index.mjs --name hostflowai-brain
pm2 save && pm2 startup
```

---

## If deploy.sh fails — Manual Steps

```bash
# Install pnpm if missing
npm install -g pnpm

# Install workspace deps (MUST run from project root, NOT inside backend/)
pnpm install --frozen-lockfile=false

# Build
cd backend && node ./build.mjs

# Run
node --enable-source-maps ./dist/index.mjs
```

---

## Repository Structure
```
backend/        ← Express API server source (TypeScript)
  src/
    routes/     ← All API routes
    lib/        ← AI advisors, memory, mailer, platform-knowledge
    middleware/ ← JWT, industry isolation, surface guard, AI limits
    config/
  build.mjs     ← esbuild bundler script
  package.json

db/             ← Drizzle ORM schema + migrations
  src/schema/   ← 25 database schema files
  drizzle.config.ts

industries/     ← Per-industry feature specs + AI advisor prompts
  hospitality/       ← Aria
  airlines/          ← Captain Orion
  car_rental/        ← Rex
  healthcare/        ← Dr. Lyra
  education/         ← Professor Sage
  logistics/         ← Atlas
  events_entertainment/ ← Vega
  railways/          ← Conductor Kai
```

---

## API Contract
```
Base URL: /api/*
Response: { ok: boolean, data: object|null, error: object|null, trace_id: string }
Auth: Supabase JWT (Authorization: Bearer <token>)
```

## 9 AI Advisors
| Advisor | Industry | Voice |
|---------|----------|-------|
| Aria | hospitality | Sarah |
| Captain Orion | airlines | George |
| Rex | car_rental | Liam |
| Dr. Lyra | healthcare | Matilda |
| Professor Sage | education | Brian |
| Atlas | logistics | Will |
| Vega | events_entertainment | Jessica |
| Conductor Kai | railways | Daniel |
| Sherlock | founder/owner | Roger |
