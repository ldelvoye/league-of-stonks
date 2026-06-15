import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../backend/app.ts";
import {
  closeIntegrationDb,
  initIntegrationDb,
  mockRiotFetchWith,
  resetIntegrationState,
} from "./helpers.ts";

const TEST_SECRET = "test-cron-secret-abc123";

describe("jobs routes integration", () => {
  const app = createApp();

  beforeAll(async () => {
    await initIntegrationDb();
  });

  beforeEach(async () => {
    await resetIntegrationState();
    process.env.CRON_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  afterAll(async () => {
    await closeIntegrationDb();
  });

  // ── Auth protection ──────────────────────────────────────────────────────────

  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app).post("/api/jobs/riot-history-sync/leaderboard");
    expect(res.status).toBe(503);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app).post("/api/jobs/riot-history-sync/leaderboard");
    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong secret is provided", async () => {
    const res = await request(app)
      .post("/api/jobs/riot-history-sync/leaderboard")
      .set("Authorization", "Bearer wrong-secret");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization uses wrong scheme", async () => {
    const res = await request(app)
      .post("/api/jobs/riot-history-sync/leaderboard")
      .set("Authorization", `Basic ${TEST_SECRET}`);
    expect(res.status).toBe(401);
  });

  // ── Leaderboard sync ─────────────────────────────────────────────────────────

  it("leaderboard sync returns a valid summary when no players exist", async () => {
    mockRiotFetchWith({});
    const res = await request(app)
      .post("/api/jobs/riot-history-sync/leaderboard")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("leaderboard");
    expect(typeof res.body.selected).toBe("number");
    expect(typeof res.body.synced).toBe("number");
    expect(typeof res.body.failed).toBe("number");
    expect(typeof res.body.durationMs).toBe("number");
    expect(typeof res.body.budgetConstrained).toBe("boolean");
    expect(res.body.riotStats).toBeDefined();
  });

  it("leaderboard sync processes top performers and runs successfully", async () => {
    // Seed a player with a snapshot so they appear on the leaderboard rollup.
    mockRiotFetchWith({
      matchIdsBody: ["NA1_5", "NA1_4", "NA1_3"],
    });
    await request(app).get("/api/player/Faker/KR1?includeHistory=1");

    // Force leaderboard rollup to populate.
    await request(app)
      .post("/api/jobs/riot-history-sync/leaderboard")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    // A second run should still work cleanly (idempotent).
    mockRiotFetchWith({
      matchIdsBody: ["NA1_5", "NA1_4", "NA1_3"],
    });
    const res = await request(app)
      .post("/api/jobs/riot-history-sync/leaderboard")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("leaderboard");
    expect(res.body.failed).toBe(0);
  });

  it("leaderboard sync only selects the top 10 rollup rows", async () => {
    const { getPool } = await import("../../backend/db/index.ts");
    const { refreshLeaderboard } = await import("../../backend/db/tables/market.ts");

    for (let i = 0; i < 12; i += 1) {
      const player = await getPool().query<{ player_id: number }>(
        `INSERT INTO players (game_name, tag_line, puuid, platform)
         VALUES ($1, 'NA1', $2, 'na1')
         RETURNING player_id`,
        [`CapPlayer${i}`, `puuid-cap-${i}`],
      );
      const playerId = player.rows[0].player_id;
      await getPool().query(
        `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
         VALUES ($1, $2, 'snapshot', NOW())`,
        [playerId, 1000],
      );
      await getPool().query(
        `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
         VALUES ($1, $2, 'snapshot', NOW() + INTERVAL '1 hour')`,
        [playerId, 1000 + (i + 1) * 10],
      );
    }

    await refreshLeaderboard();
    const rollupCount = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM leaderboard_rollup`,
    );
    expect(Number(rollupCount.rows[0].count)).toBe(12);

    process.env.CRON_RIOT_BUDGET_THRESHOLD = "1000";
    try {
      mockRiotFetchWith({
        matchIdsBody: [],
      });

      const res = await request(app)
        .post("/api/jobs/riot-history-sync/leaderboard")
        .set("Authorization", `Bearer ${TEST_SECRET}`);

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("leaderboard");
      expect(res.body.selected).toBe(10);
      expect(res.body.synced + res.body.failed).toBe(10);
      expect(res.body.skipped).toBe(0);
    } finally {
      delete process.env.CRON_RIOT_BUDGET_THRESHOLD;
    }
  });

  it("leaderboard rollup is capped to the top 100 deltas", async () => {
    const { getPool } = await import("../../backend/db/index.ts");
    const { refreshLeaderboard } = await import("../../backend/db/tables/market.ts");

    await getPool().query(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       SELECT
         'RollupCap' || gs::text,
         'NA1',
         'puuid-rollup-cap-' || gs::text,
         'na1'
       FROM generate_series(1, 105) AS gs`,
    );

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       SELECT p.player_id, 1000, 'snapshot', NOW()
       FROM players p
       WHERE p.game_name LIKE 'RollupCap%'`,
    );

    await getPool().query(
      `WITH seeded AS (
         SELECT player_id, ROW_NUMBER() OVER (ORDER BY player_id) AS rn
         FROM players
         WHERE game_name LIKE 'RollupCap%'
       )
       INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       SELECT
         seeded.player_id,
         1000 + seeded.rn,
         'snapshot',
         NOW() + INTERVAL '1 hour'
       FROM seeded`,
    );

    await refreshLeaderboard();

    const rollupStats = await getPool().query<{
      count: string;
      min_delta: string;
      max_delta: string;
    }>(
      `SELECT
         COUNT(*)::text AS count,
         MIN(delta_lp)::text AS min_delta,
         MAX(delta_lp)::text AS max_delta
       FROM leaderboard_rollup`,
    );

    expect(Number(rollupStats.rows[0].count)).toBe(100);
    expect(Number(rollupStats.rows[0].max_delta)).toBe(105);
    expect(Number(rollupStats.rows[0].min_delta)).toBe(6);
  });

  // ── Random discovery sync ────────────────────────────────────────────────────

  it("random sync returns a valid summary when no stale players exist", async () => {
    const res = await request(app)
      .post("/api/jobs/riot-history-sync/random")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("random-discovery");
    expect(res.body.selected).toBe(0);
    expect(res.body.failed).toBe(0);
    expect(res.body.riotStats).toBeDefined();
  });

  it("random sync processes a stale player and returns synced count", async () => {
    // Insert a player with no snapshots so they qualify as stale.
    const { getPool } = await import("../../backend/db/index.ts");
    await getPool().query(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('StalePlaya', 'NA1', 'puuid-stale', 'na1')`,
    );

    mockRiotFetchWith({
      accountBody: { puuid: "puuid-stale", gameName: "StalePlaya", tagLine: "NA1" },
      matchIdsBody: ["NA1_10", "NA1_9"],
    });

    const res = await request(app)
      .post("/api/jobs/riot-history-sync/random")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("random-discovery");
    expect(res.body.selected).toBeGreaterThanOrEqual(1);
    expect(res.body.synced).toBeGreaterThanOrEqual(1);
    expect(res.body.failed).toBe(0);
  });

  // ── Budget status ────────────────────────────────────────────────────────────

  it("GET /api/jobs/riot-budget returns usage stats", async () => {
    const res = await request(app)
      .get("/api/jobs/riot-budget")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.last15mTotal).toBe("number");
    expect(typeof res.body.last15m429s).toBe("number");
    expect(typeof res.body.last2mTotal).toBe("number");
    expect(typeof res.body.availableShortBudget).toBe("number");
    expect(typeof res.body.availableLongBudget).toBe("number");
  });

  it("riot budget reflects calls made during the test run", async () => {
    // Make a Riot call via the player route to register usage.
    mockRiotFetchWith({ matchIdsBody: ["NA1_1"] });
    await request(app).get("/api/player/Faker/KR1");

    const res = await request(app)
      .get("/api/jobs/riot-budget")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.last15mTotal).toBeGreaterThan(0);
    expect(res.body.availableLongBudget).toBeLessThan(90);
  });

  // ── Budget threshold ─────────────────────────────────────────────────────────

  it("leaderboard sync skips work when budget threshold is reached", async () => {
    // Set a threshold of 0 so any existing usage triggers the skip.
    process.env.CRON_RIOT_BUDGET_THRESHOLD = "0";

    // Make one Riot call so last2mTotal > 0.
    mockRiotFetchWith({ matchIdsBody: ["NA1_1"] });
    await request(app).get("/api/player/Faker/KR1");

    const res = await request(app)
      .post("/api/jobs/riot-history-sync/leaderboard")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.budgetConstrained).toBe(true);
    expect(res.body.selected).toBe(0);

    delete process.env.CRON_RIOT_BUDGET_THRESHOLD;
  });

  it("random sync skips all work when budget threshold is reached", async () => {
    process.env.CRON_RIOT_BUDGET_THRESHOLD = "0";

    mockRiotFetchWith({ matchIdsBody: ["NA1_1"] });
    await request(app).get("/api/player/Faker/KR1");

    const res = await request(app)
      .post("/api/jobs/riot-history-sync/random")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.budgetConstrained).toBe(true);
    expect(res.body.selected).toBe(0);

    delete process.env.CRON_RIOT_BUDGET_THRESHOLD;
  });

  // ── queryRandomStalePlayers ──────────────────────────────────────────────────

  it("random sync does not select players synced within the last 5 minutes", async () => {
    // Seed a player and give them a fresh snapshot.
    const { getPool } = await import("../../backend/db/index.ts");
    const result = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('FreshPlayer', 'NA1', 'puuid-fresh', 'na1')
       RETURNING player_id`,
    );
    const playerId = result.rows[0].player_id;
    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, 1500, 'snapshot', NOW())`,
      [playerId],
    );

    const res = await request(app)
      .post("/api/jobs/riot-history-sync/random")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    // FreshPlayer should not appear in selected targets.
    expect(res.body.selected).toBe(0);
  });
});
