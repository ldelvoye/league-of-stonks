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
      .post("/api/jobs/riot-history-sync/random?limit=1")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("random-discovery");
    expect(res.body.selected).toBe(1);
    expect(res.body.synced).toBe(1);
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

  it("random sync reduces limit when approaching budget threshold", async () => {
    process.env.CRON_RIOT_BUDGET_THRESHOLD = "0";

    mockRiotFetchWith({ matchIdsBody: ["NA1_1"] });
    await request(app).get("/api/player/Faker/KR1");

    const res = await request(app)
      .post("/api/jobs/riot-history-sync/random?limit=3")
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
      .post("/api/jobs/riot-history-sync/random?limit=5")
      .set("Authorization", `Bearer ${TEST_SECRET}`);

    expect(res.status).toBe(200);
    // FreshPlayer should not appear in selected targets.
    expect(res.body.selected).toBe(0);
  });
});
