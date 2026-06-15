import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../backend/app.ts";
import { getPool } from "../../backend/db/index.ts";
import { recordScoreSnapshot } from "../../backend/db/tables/scores.ts";
import { refreshLeaderboard } from "../../backend/db/tables/market.ts";
import { marketCache } from "../../backend/routes/market.ts";
import {
  closeIntegrationDb,
  initIntegrationDb,
  resetIntegrationState,
} from "./helpers.ts";

describe("market routes integration", () => {
  // A single app instance is shared within this describe block so that cache
  // state can be deliberately controlled (cleared in beforeEach).
  const app = createApp();

  beforeAll(async () => {
    await initIntegrationDb();
  });

  beforeEach(async () => {
    await resetIntegrationState();
    // Clear the shared module-level market cache between tests so each test
    // starts from a known empty-cache state.
    marketCache.clear();
  });

  afterAll(async () => {
    await closeIntegrationDb();
  });

  async function seedPlayer(
    gameName: string,
    tagLine: string,
    score: number | null,
  ): Promise<number> {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ($1, $2, $3, 'na1')
       RETURNING player_id`,
      [gameName, tagLine, `puuid-mkt-${gameName}-${tagLine}`],
    );
    const playerId = inserted.rows[0].player_id;
    await recordScoreSnapshot(playerId, score);
    return playerId;
  }

  // ── /api/market/stats ─────────────────────────────────────────────────────

  it("stats returns tracked summoners and trade counts", async () => {
    await seedPlayer("Alpha", "NA1", 1200);
    await seedPlayer("Beta", "NA1", 900);

    const res = await request(app).get("/api/market/stats");
    expect(res.status).toBe(200);
    expect(res.body.trackedSummoners).toBe(2);
    expect(res.body.totalTrades).toBe(0);
    expect(typeof res.body.volume24h).toBe("string");
  });

  it("stats are served from cache on a second request within TTL", async () => {
    await seedPlayer("CacheTarget", "NA1", 1500);

    // First request: populates the cache with 1 summoner.
    const r1 = await request(app).get("/api/market/stats");
    expect(r1.status).toBe(200);
    expect(r1.body.trackedSummoners).toBe(1);

    // Insert a second player directly into DB — bypasses the cache.
    await seedPlayer("ShouldBeHidden", "NA1", 1000);

    // Second request within TTL: should still return the cached count of 1.
    const r2 = await request(app).get("/api/market/stats");
    expect(r2.status).toBe(200);
    expect(r2.body.trackedSummoners).toBe(1);
  });

  it("stats cache records hit after a repeated request", async () => {
    await seedPlayer("MetricsTarget", "NA1", 800);

    await request(app).get("/api/market/stats"); // miss
    await request(app).get("/api/market/stats"); // hit

    const metrics = marketCache.getMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(1);
  });

  // ── /api/market/top ───────────────────────────────────────────────────────

  it("top performers returns players from the leaderboard rollup", async () => {
    const playerId = await seedPlayer("Climber", "NA1", 1000);
    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW() + INTERVAL '1 hour')`,
      [playerId, 1300],
    );
    await getPool().query(
      `INSERT INTO player_latest_scores (player_id, score, recorded_at, source, updated_at)
       VALUES ($1, 1300, NOW() + INTERVAL '1 hour', 'snapshot', NOW())
       ON CONFLICT (player_id) DO UPDATE
         SET score       = EXCLUDED.score,
             recorded_at = EXCLUDED.recorded_at,
             source      = EXCLUDED.source,
             updated_at  = NOW()
         WHERE player_latest_scores.recorded_at <= EXCLUDED.recorded_at`,
      [playerId],
    );

    await refreshLeaderboard();

    const res = await request(app).get("/api/market/top?limit=10&window=30");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const entry = res.body.find(
      (r: { gameName: string }) => r.gameName.toLowerCase() === "climber",
    );
    expect(entry).toBeTruthy();
    expect(entry.deltaLp).toBe(300);
  });

  it("top performers returns empty list when no rollup data exists", async () => {
    const res = await request(app).get("/api/market/top?limit=10&window=30");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("leaderboard rollup reflects score improvements", async () => {
    const playerId = await seedPlayer("Grinder", "NA1", 500);

    // First rollup includes the player with a neutral delta.
    await refreshLeaderboard();
    const r1 = await request(app).get("/api/market/top?limit=10&window=30");
    expect(r1.status).toBe(200);
    const before = r1.body.find(
      (r: { gameName: string }) => r.gameName.toLowerCase() === "grinder",
    );
    expect(before).toBeTruthy();
    expect(before.deltaLp).toBe(0);

    // Add a second, higher score snapshot.
    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, 800, 'snapshot', NOW() + INTERVAL '1 hour')`,
      [playerId],
    );

    // Re-run rollup and use a fresh cache key (different limit) to bypass cache.
    marketCache.clear();
    await refreshLeaderboard();
    const r2 = await request(app).get("/api/market/top?limit=5&window=30");
    expect(r2.status).toBe(200);
    const after = r2.body.find(
      (r: { gameName: string }) => r.gameName.toLowerCase() === "grinder",
    );
    expect(after).toBeTruthy();
    expect(after.deltaLp).toBe(300);
  });

  it("leaderboard refresh keeps rows when delta returns to zero", async () => {
    const playerId = await seedPlayer("Backslider", "NA1", 700);
    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, 900, 'snapshot', NOW() + INTERVAL '1 hour')`,
      [playerId],
    );

    marketCache.clear();
    await refreshLeaderboard();
    const before = await request(app).get("/api/market/top?limit=10&window=30");
    expect(before.status).toBe(200);
    const presentBefore = before.body.find(
      (r: { gameName: string }) => r.gameName.toLowerCase() === "backslider",
    );
    expect(presentBefore).toBeTruthy();

    // Latest score drops back to baseline, so the 30-day delta returns to zero.
    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, 700, 'snapshot', NOW() + INTERVAL '2 hours')`,
      [playerId],
    );

    marketCache.clear();
    await refreshLeaderboard();
    const after = await request(app).get("/api/market/top?limit=10&window=30");
    expect(after.status).toBe(200);
    const presentAfter = after.body.find(
      (r: { gameName: string }) => r.gameName.toLowerCase() === "backslider",
    );
    expect(presentAfter).toBeTruthy();
    expect(presentAfter.deltaLp).toBe(0);
  });

  // ── /api/market/recent-trades ─────────────────────────────────────────────

  it("recent trades returns empty list when no trades exist", async () => {
    const res = await request(app).get("/api/market/recent-trades?limit=10");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("recent trades are served from cache on a second request", async () => {
    const playerId = await seedPlayer("CachedTrader", "NA1", 1000);

    // First fetch — empty, cached.
    const r1 = await request(app).get("/api/market/recent-trades?limit=9");
    expect(r1.status).toBe(200);
    expect(r1.body).toHaveLength(0);

    // Insert a trade directly into the DB after the cache is warm.
    const userRes = await getPool().query<{ user_id: number }>(
      `INSERT INTO users (username, email, password_hash) VALUES ('ctr', 'ctr@x.com', 'h') RETURNING user_id`,
    );
    const userId = userRes.rows[0].user_id;
    const pfRes = await getPool().query<{ portfolio_id: number }>(
      `INSERT INTO portfolios (user_id, lp_balance) VALUES ($1, 50000) RETURNING portfolio_id`,
      [userId],
    );
    await getPool().query(
      `INSERT INTO portfolio_trades (portfolio_id, player_id, side, shares, price_per_share, total_value)
       VALUES ($1, $2, 'buy', 1, 1000, 1000)`,
      [pfRes.rows[0].portfolio_id, playerId],
    );

    // Second fetch with the same limit (same cache key) — should still be empty.
    const r2 = await request(app).get("/api/market/recent-trades?limit=9");
    expect(r2.status).toBe(200);
    expect(r2.body).toHaveLength(0);
  });

  it("rejects invalid query params with 400 responses", async () => {
    const topBadLimit = await request(app).get("/api/market/top?limit=-1&window=30");
    expect(topBadLimit.status).toBe(400);

    const topBadWindow = await request(app).get("/api/market/top?limit=10&window=0");
    expect(topBadWindow.status).toBe(400);

    const recentBadLimit = await request(app).get("/api/market/recent-trades?limit=abc");
    expect(recentBadLimit.status).toBe(400);
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  it("rate limiter blocks excessive market requests from a single IP", async () => {
    // Use a unique IP so this test does not interfere with the shared in-memory
    // rate-limit bucket used by other tests in this suite.
    const uniqueIp = "10.99.88.77";
    const responses: number[] = [];

    // The market limiter allows 300 requests per 15 min; 301 should trigger one rejection.
    for (let i = 0; i < 301; i++) {
      const res = await request(app)
        .get("/api/market/stats")
        .set("X-Forwarded-For", uniqueIp);
      responses.push(res.status);
    }

    expect(responses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(responses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  });
});
