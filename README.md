# HostFlow AI Brain

Backend API server for HostFlow AI — 8-industry AI automation OS.

## Stack
- Node.js 24 + TypeScript 5.9
- Express 5
- PostgreSQL + Drizzle ORM
- GPT-5 (OpenAI compatible endpoint)
- ElevenLabs voice
- Resend email
- Polar.sh payments

## Structure
```
backend/        ← Express API server source (TypeScript)
  src/
    routes/     ← All API routes
    lib/        ← AI advisors, memory, mailer, platform-knowledge
    middleware/ ← JWT, industry isolation, surface guard, AI limits
    config/

db/             ← Drizzle ORM schema + migrations
  src/schema/   ← 25 database schema files

industries/     ← Per-industry feature specs + AI advisor prompts
  hospitality/  ← Aria
  airlines/     ← Captain Orion
  car_rental/   ← Rex
  healthcare/   ← Dr. Lyra
  education/    ← Professor Sage
  logistics/    ← Atlas
  events_entertainment/ ← Vega
  railways/     ← Conductor Kai
```

## Build & Run

```bash
# Install dependencies
pnpm install

# Build
cd backend && node ./build.mjs

# Run
node --enable-source-maps ./dist/index.mjs
```

## Environment
Copy `.env.example` to `.env` and fill in all values before running.

## API
Base URL: `/api/*`
All responses: `{ ok: boolean, data: object|null, error: object|null, trace_id: string }`

## 9 AI Advisors
| Advisor | Industry |
|---|---|
| Aria | hospitality |
| Captain Orion | airlines |
| Rex | car_rental |
| Dr. Lyra | healthcare |
| Professor Sage | education |
| Atlas | logistics |
| Vega | events_entertainment |
| Conductor Kai | railways |
| Sherlock | founder/owner |
