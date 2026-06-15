# Riot API costs

Reference for outbound Riot API usage in this project. Counts are per HTTP request to Riot (one `riotFetch` call).

## Riot endpoints used

| Step         | Riot endpoint                    | When it runs                                         |
| ------------ | -------------------------------- | ---------------------------------------------------- |
| `account`    | Account by Riot ID               | First time a player is resolved and stored in the DB |
| `match-list` | Ranked solo match IDs (up to 10) | Start of every player sync                           |
| `match`      | Match detail                     | Once per pending match not already in the DB         |
| `league`     | League entries by PUUID          | Score anchor, up-to-date check, and lobby snapshots  |

Player sync depth is capped at 10 matches (`MATCH_SYNC_DEPTH`). Lobby snapshots can add up to 9 extra `league` calls per synced match.

## Shared player sync cost model

Most Riot traffic goes through `refreshPlayerScoreIfNeeded` in `backend/lib/playerService.ts`. User routes and cron jobs call into this path. Portfolio trades use a separate, always-live path (see below).

| Scenario                                              | Riot calls                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Cooldown skip (synced within last 5 minutes)          | 0                                                                                          |
| Already up to date (latest confirmed match is newest) | 1 (`match-list`), sometimes +1 `league` if no cached score                                 |
| Typical incremental refresh (1–2 new games)           | 1 `match-list` + 1–2 `match` + 0–1 `league` + 0–9 `league` (lobby)                         |
| Full backfill (10 pending matches, new player)        | 1 `account` + 1 `match-list` + 10 `match` + 1 `league` + up to 9 `league` (lobby) = **22** |
| Full backfill (existing player)                       | 1 `match-list` + 10 `match` + 1 `league` + up to 9 `league` = **21**                       |

Lobby `league` calls are skipped when a lobby player already has a snapshot within the 5-minute refresh cooldown. The `league` anchor call is skipped when a local `snapshot` row is newer than the pending match.

## HTTP route costs

Routes that never call Riot: `/health`, `/api/auth/*`, `/api/market/*`, `GET /api/portfolio`, `GET /api/jobs/riot-budget`.

### `GET /api/player/:gameName/:tagLine`

| Condition                              | Min | Typical | Max   |
| -------------------------------------- | --- | ------- | ----- |
| Cached score in DB, no `refresh`       | 0   | 0       | 0     |
| `refresh=1`, within cooldown           | 0   | 0       | 0     |
| `refresh=1`, already up to date        | 1   | 1       | 2     |
| `refresh=1`, 1–2 new games             | 3   | 4–13    | 13    |
| First visit / no cache (implicit sync) | 3   | 4–13    | 22    |
| `refresh=1`, full 10-match backfill    | 12  | 12–21   | 21–22 |

`includeHistory=1` does not change Riot usage; it only affects the response shape.

### `GET /api/player/:gameName/:tagLine/history`

| Condition | Min | Typical | Max |
| --------- | --- | ------- | --- |
| Any       | 0   | 0       | 0   |

Reads from Postgres only.

### `POST /api/portfolio/trades`

Uses `getPlayerScoreForTrade`, which always calls `recordCurrentLeagueSnapshot` (one `GET /league` Riot call) regardless of the 5-minute cooldown. Concurrent trades for the same player are collapsed into a single in-flight request via single-flight deduplication (`activeLeagueSnapshots` map in `playerService.ts`).

| Condition                        | Riot calls |
| -------------------------------- | ---------- |
| Any (player found, any cooldown) | **1** (`league`) |
| Player not in DB                 | 0 (returns null → 404) |

**Sustained Riot load:** 1 `league` call per trade (after dedup). With the per-user rate limit of 20 trades / 15 min, one maximally active user contributes at most ~1.3 `league` calls per minute. With 20 simultaneous users all at the rate limit: ~27 calls/minute = well within the 90/2min outbound budget.

## Cron job costs

Cron jobs call `POST /api/jobs/riot-history-sync/*` via `scripts/trigger-riot-history-sync.js`. The trigger script makes no Riot calls itself.

Budget is checked before each player using live usage stats. Default cron budget threshold is **60 calls per 2 minutes** (`CRON_RIOT_BUDGET_THRESHOLD`). The hard outbound limiter allows up to **90 calls per 2 minutes**, leaving headroom for user traffic.

### Leaderboard sync (`POST /api/jobs/riot-history-sync/leaderboard`)

Syncs players from `leaderboard_rollup` in `delta_lp` order until budget runs out. Recomputes the leaderboard rollup after successful syncs.

The home page shows the top **10** performers (`GET /api/market/top?limit=10`). The cron job syncs every qualifying row in `leaderboard_rollup` (all players with positive 30-day LP gain), ordered by `delta_lp` — not only the 10 displayed on the home page.

Planning cost per player: **13** (assumes at most 2 new games: 1 `match-list` + 2 `match` + 1 `league` + 9 lobby `league`).

| Metric                                                   | Min | Max                                                                                           |
| -------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------- |
| Per run (no work: budget exhausted or empty leaderboard) | 0   | 0                                                                                             |
| Per player synced (already up to date)                   | 1   | 2                                                                                             |
| Per player synced (2 new games, full lobby)              | 4   | 13                                                                                            |
| Per player synced (worst case)                           | 12  | 21                                                                                            |
| Per run at default budget (60), cold start               | 0   | ~4 players × 13 = **52** (planning stops here; actual may be lower if players are up to date) |
| Per run at default budget (60), all players worst case   |     | 4 × 21 = **84**                                                                               |

At the default budget, `floor(60 / 13) = 4` players can be synced per run. With a full top-10 leaderboard and a cold budget, the top 4 sync this run and the remaining 6 are deferred to the next run.

### Random discovery (`POST /api/jobs/riot-history-sync/random`)

Loops over random stale players until budget runs out or no stale players remain.

Planning cost per player: **21** (worst case: 1 `match-list` + 10 `match` + 1 `league` + 9 lobby `league`).

| Metric                                                        | Min | Max                                                         |
| ------------------------------------------------------------- | --- | ----------------------------------------------------------- |
| Per run (no work: budget exhausted or no stale players)       | 0   | 0                                                           |
| Per player synced (already up to date / cooldown)             | 0   | 2                                                           |
| Per player synced (typical stale player, few pending matches) | 3   | 10                                                          |
| Per player synced (worst case, full backfill)                 | 12  | 21–22                                                       |
| Per run at default budget (60), cold start                    | 0   | 2 players × 21 = **42** (planning stops after 2 iterations) |
| Per run at default budget (60), all players worst case        |     | 2 × 21 = **42**                                             |

Each synced player can also add up to 9 new players to the DB via lobby snapshots. Those new players become candidates for future discovery runs.

## Rate limiting

| Layer                                    | Limit                             | Purpose                                             |
| ---------------------------------------- | --------------------------------- | --------------------------------------------------- |
| Riot (vendor)                            | 20 / 1s, 100 / 2min               | Hard API quota                                      |
| Outbound limiter (`backend/lib/riot.ts`) | 18 / 1s, 90 / 2min (configurable) | Shared throttle for all outbound calls              |
| Cron budget threshold                    | 60 / 2min (configurable)          | Cron pre-check before starting each player          |
| Player `refresh=1` route                 | 10 / 15min per IP                 | Protects user-triggered syncs                       |
| Trade route (burst)                      | 5 / 30s per user                  | Prevents rapid-fire bot trading and Riot call bursts |
| Trade route (sustained)                  | 20 / 15min per user               | Caps per-user Riot load from trade execution        |

Inspect live usage: `GET /api/jobs/riot-budget` (requires `CRON_SECRET`).
