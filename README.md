# League of Stonks

> **Archived.** Ran from June to August 2026; no longer deployed, and `leagueofstonks.com` is gone. The code is here for anyone curious.

A fantasy stock market for League of Legends. Every ranked player is a stock, their LP is the share price, and you get 50,000 LP of play money to bet on who's about to climb and who's about to tilt. Buy the smurf early, sell before the losing streak.

Prices came from real match history via the Riot API. Background jobs walked the ranked ladder to keep them fresh — and since every synced match also seeded the other nine players in the lobby, the database taught itself about 261,000 players along the way.

NA (`na1`) only, ranked solo queue only, season 16 only.

## Why it's archived

The discovery jobs worked a little too well. 261k players and 906k score snapshots piled up against a 500 MB free-tier database, and two queries that scanned the entire players table on every run — the leaderboard rollup and an `ORDER BY RANDOM()` player picker — grew into 98% of all database time. Faced with paying to keep a 13-user hobby project alive, I turned it off and opened the source instead.

## Stack

TypeScript end to end. Express and Postgres (Supabase) on the back, React with Vite and React Router on the front, both deployed on Railway.

## Repo map

| Path              | What's in it                                                |
| ----------------- | ----------------------------------------------------------- |
| `backend/routes/` | HTTP routes                                                 |
| `backend/lib/`    | Domain logic — Riot client, LP estimation, portfolios, auth |
| `backend/db/`     | Connection pool, migrations, per-table query modules        |
| `backend/jobs/`   | Scheduled sync and cleanup jobs                             |
| `frontend/src/`   | React routes, components, state                             |
| `frontend/lib/`   | Shared API, formatting, and data helpers                    |
| `scripts/`        | One-off utilities and the cron trigger                      |
| `tests/`          | Unit and integration tests (`npm test`)                     |

## Running it locally

You'll need a Riot API key and a Postgres database. Copy `.env.example` to `.env` and fill in `RIOT_API_KEY` and `DATABASE_URL` — that's enough to boot; the rest of the variables are documented inline in that file.

```bash
npm install
npm run db:up        # local Postgres via Docker
npm run db:migrate   # apply schema
npm run db:seed      # optional: insert a test player

npm run dev                  # backend on :3000
npm run local:dev:frontend   # frontend on :3001
```

Other database commands: `npm run db:status` shows applied versus pending migrations, and `npm run db:schema` migrates and then regenerates `backend/db/schema.snapshot.md`.

For production builds, `npm run build` compiles both halves and `npm run start:backend` runs the compiled server.

## API

```
GET  /health
GET  /api/player/:gameName/:tagLine            # score, optional ?refresh=1 and ?includeHistory=1
GET  /api/player/:gameName/:tagLine/history
GET  /api/market/stats | /top | /recent-trades
GET  /api/portfolio                            # session-authenticated
POST /api/portfolio/trades
     /api/auth/*                               # register, login, logout, email verification,
                                               # password reset, profile updates
POST /api/jobs/riot-history-sync/leaderboard   # cron, bearer CRON_SECRET
POST /api/jobs/riot-history-sync/random        # cron, bearer CRON_SECRET
GET  /api/jobs/riot-budget                     # cron, bearer CRON_SECRET
```

Riot rate limits are the real constraint on all of this. [`docs/riot-api-costs.md`](docs/riot-api-costs.md) works out the exact call cost of every route and cron job against Riot's 20/second and 100/2-minute budgets.

## How it was deployed

Four Railway services off this one repo:

- **backend** — `npm ci && npm run build:backend`, started with `npm run start:backend`
- **frontend** — `npm ci && npm run build:frontend`, served statically from `frontend/dist` (see `Staticfile`)
- **leaderboard-sync** — cron, every 30 minutes, running `node scripts/trigger-riot-history-sync.js` with `SYNC_MODE=leaderboard`
- **random-discovery** — cron, every 5 minutes, same script with `SYNC_MODE=random-discovery`

The cron services just POST to the backend's `/api/jobs/*` endpoints with a shared `CRON_SECRET`. Postgres was Supabase; the backend connected through the session pooler.

## License

MIT — see [LICENSE](LICENSE).
