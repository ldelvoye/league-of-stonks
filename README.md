# League of Stonks

League of Stonks is a TypeScript monorepo with:

- a backend API (`Express` + `Postgres` via Supabase)
- a frontend static app (plain TS + HTML/CSS, no React/Vite)

Current product scope:

- Early-stage beta
- Only NA (`na1`) players are supported right now

## Repo map

- `backend/` API server and business logic
- `backend/db/` DB connection, migrations, table access
- `backend/routes/` HTTP routes
- `backend/lib/` domain/service logic
- `frontend/` static UI source (`index.html`, `styles.css`, TS modules)
- `scripts/` utility scripts (for example seed scripts)
- `tsconfig.json` backend TS config (outputs to `backend/dist`)
- `frontend/tsconfig.json` frontend TS config (outputs to `frontend/dist`)

## Runtime architecture

- Backend exposes:
  - `GET /health`
  - `GET /api/player/:gameName/:tagLine`
  - `GET /api/player/:gameName/:tagLine/history`
- Frontend fetches backend API from:
  - `http://localhost:3000` when frontend runs locally on `localhost:3001`
  - `https://api.leagueofstonks.com` otherwise
- Backend CORS allowlist comes from `ALLOWED_ORIGINS` (comma-separated)

## Environment variables

Create a `.env` in repo root (or set env vars in Railway):

- `RIOT_API_KEY` Riot API key
- `DATABASE_URL` Supabase Postgres URL (use session pooler for deployed backend)
- `ALLOWED_ORIGINS` frontend origins allowed for CORS, comma-separated

`.env.example` has the canonical variable list.

## Commands

### Production-oriented commands

- `npm run build:backend` compile backend to `backend/dist`
- `npm run build:frontend` compile frontend TS to `frontend/dist`
- `npm run build` build both backend and frontend
- `npm run start:backend` run compiled backend (`backend/dist/index.js`)

### Local development commands

- `npm run dev` run backend in watch mode via `tsx`
- `npm run local:dev:frontend` watch-compile frontend TS
- `npm run local:start:frontend` serve frontend at `http://localhost:3001`

Typical local split workflow:

1. Terminal A: `npm run dev` (backend on `:3000`)
2. Terminal B: `npm run local:dev:frontend`
3. Terminal C: `npm run local:start:frontend` (frontend on `:3001`)

## Database workflow

- `npm run db:up` start local Postgres via Docker
- `npm run db:migrate` apply schema/migrations using current `DATABASE_URL`
- `npm run db:status` show applied vs pending migrations
- `npm run db:seed` insert test player history data

## Deployment (Railway)

Use two Railway services from the same repo.

### Backend service

- Build command: `npm ci && npm run build:backend`
- Start command: `npm run start:backend`
- Required vars: `RIOT_API_KEY`, `DATABASE_URL`, `ALLOWED_ORIGINS`
- Domain: `https://api.leagueofstonks.com`

### Frontend service

- Build command: `npm ci && npm run build:frontend`
- Start command: blank (static hosting)
- Static root: `frontend` (configured with `Staticfile`)
- Custom domain: `leagueofstonks.com` / `www.leagueofstonks.com`

## Conventions for contributors and coding agents

- Keep backend and frontend deployable independently.
- Keep code in TypeScript.
- Treat `build:*` and `start:backend` as production commands.
- Use `local:*` commands only for local-only behavior (watch mode, local static port).
- Do not introduce duplicate utilities/routes if similar logic already exists; extend existing modules when possible.
- Prefer small, focused changes that keep API behavior predictable.