import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../backend/app.ts";
import { getPool } from "../../backend/db/index.ts";
import { recordMatchScoreSnapshot } from "../../backend/db/tables/scores.ts";
import { SEASON_16_KEY, SEASON_16_START_ISO } from "../../backend/lib/seasons.ts";
import {
  closeIntegrationDb,
  countRiotFetchCalls,
  initIntegrationDb,
  mockRiotFetchWith,
  resetIntegrationState,
} from "./helpers.ts";

describe("player routes integration", () => {
  const app = createApp();

  beforeAll(async () => {
    await initIntegrationDb();
  });

  beforeEach(async () => {
    await resetIntegrationState();
  });

  afterAll(async () => {
    await closeIntegrationDb();
  });

  it("syncs match history on first refresh and returns match-aware points", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_10", "NA1_9", "NA1_8"],
    });

    const response = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=20");
    expect(response.status).toBe(200);
    expect(response.body.gameName).toBe("Faker");
    expect(response.body.tagLine).toBe("KR1");
    expect(Array.isArray(response.body.history)).toBe(true);
    expect(response.body.history).toHaveLength(3);

    const newest = response.body.history[response.body.history.length - 1];
    expect(newest.matchId).toBe("NA1_10");
    expect(newest.source).toBe("confirmed");
    expect(typeof newest.won).toBe("boolean");

    expect(countRiotFetchCalls(/\/riot\/account\/v1\/accounts\/by-riot-id\//)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(3);
    expect(countRiotFetchCalls(/\/lol\/league\/v4\/entries\/by-puuid\//)).toBe(1);
  });

  it("reconciles renamed players by puuid without creating duplicate player rows", async () => {
    const seeded = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('OldName', 'NA1', 'puuid-rename', 'na1')
       RETURNING player_id`,
    );
    const originalPlayerId = seeded.rows[0].player_id;

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, match_id, game_ended_at, source, recorded_at)
       VALUES ($1, 1500, 'NA1_SEED', NOW(), 'confirmed', NOW())`,
      [originalPlayerId],
    );

    mockRiotFetchWith({
      accountBody: { puuid: "puuid-rename", gameName: "NewName", tagLine: "NA1" },
    });
    const renamed = await request(app).get("/api/player/NewName/NA1?includeHistory=1&limit=20");
    expect(renamed.status).toBe(200);
    expect(renamed.body.gameName).toBe("NewName");
    expect(renamed.body.tagLine).toBe("NA1");

    const rows = await getPool().query<{ player_id: number; game_name: string; tag_line: string }>(
      `SELECT player_id, game_name, tag_line
       FROM players
       WHERE puuid = 'puuid-rename' AND platform = 'na1'`,
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].player_id).toBe(originalPlayerId);
    expect(rows.rows[0].game_name).toBe("NewName");
    expect(rows.rows[0].tag_line).toBe("NA1");
    expect(countRiotFetchCalls(/\/riot\/account\/v1\/accounts\/by-riot-id\//)).toBe(1);
  });

  it("returns early when latest confirmed match is already known", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(seeded.status).toBe(200);

    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const refresh = await request(app).get("/api/player/Faker/KR1?refresh=1");
    expect(refresh.status).toBe(200);
    expect(refresh.body.score).toBe(1450);

    expect(countRiotFetchCalls(/\/riot\/account\/v1\/accounts\/by-riot-id\//)).toBe(0);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(0);
    expect(countRiotFetchCalls(/\/lol\/league\/v4\/entries\/by-puuid\//)).toBe(0);
  });

  it("stops detail fetches once it reaches latest confirmed match", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(seeded.status).toBe(200);

    mockRiotFetchWith({
      matchIdsBody: ["NA1_5", "NA1_4", "NA1_3", "NA1_2"],
    });
    const refresh = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10&refresh=1");
    expect(refresh.status).toBe(200);
    expect(refresh.body.history).toHaveLength(4);

    const newest = refresh.body.history[refresh.body.history.length - 1];
    expect(newest.matchId).toBe("NA1_5");
    expect(newest.source).toBe("confirmed");

    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(2);
    expect(countRiotFetchCalls(/\/lol\/league\/v4\/entries\/by-puuid\//)).toBe(1);
  });

  it("walks through fresh snapshot rows and still stops on confirmed anchor", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(seeded.status).toBe(200);

    const playerRows = await getPool().query<{ player_id: number }>(
      `SELECT player_id FROM players WHERE LOWER(game_name) = LOWER('Faker') AND LOWER(tag_line) = LOWER('KR1')`,
    );
    const playerId = playerRows.rows[0]?.player_id;
    expect(playerId).toBeTruthy();

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW())`,
      [playerId, 1510],
    );

    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const refresh = await request(app).get("/api/player/Faker/KR1?refresh=1");
    expect(refresh.status).toBe(200);
    expect(refresh.body.score).toBe(1510);

    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(0);
    expect(countRiotFetchCalls(/\/lol\/league\/v4\/entries\/by-puuid\//)).toBe(0);
  });

  it("uses snapshot source as score anchor to skip league call", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(seeded.status).toBe(200);

    const playerRows = await getPool().query<{ player_id: number }>(
      `SELECT player_id FROM players WHERE LOWER(game_name) = LOWER('Faker') AND LOWER(tag_line) = LOWER('KR1')`,
    );
    const playerId = playerRows.rows[0]?.player_id;
    expect(playerId).toBeTruthy();

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW())`,
      [playerId, 1600],
    );

    mockRiotFetchWith({
      matchIdsBody: ["NA1_5", "NA1_4", "NA1_3", "NA1_2"],
    });
    const refresh = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=20&refresh=1");
    expect(refresh.status).toBe(200);

    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(2);
    expect(countRiotFetchCalls(/\/lol\/league\/v4\/entries\/by-puuid\//)).toBe(0);

    const confirmedRow = await getPool().query<{ score: number | null; source: string }>(
      `SELECT score, source
       FROM score_snapshots
       WHERE player_id = $1 AND match_id = 'NA1_5'`,
      [playerId],
    );
    expect(confirmedRow.rows[0]?.score).toBe(1600);
    expect(confirmedRow.rows[0]?.source).toBe("confirmed");
  });

  it("keeps sparse-anchor backfill swings conservative", async () => {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('SparseSwing', 'NA1', 'puuid-sparse', 'na1')
       RETURNING player_id`,
    );
    const playerId = inserted.rows[0].player_id;
    const now = Date.now();
    const olderAnchorAt = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const newerAnchorAt = new Date(now - 9 * 24 * 60 * 60 * 1000);

    await getPool().query(
      `INSERT INTO score_snapshots (
         player_id,
         score,
         match_id,
         game_ended_at,
         source,
         won,
         recorded_at
       )
       VALUES
         ($1, 1000, 'NA1_anchor_old', $2, 'confirmed', FALSE, $2),
         ($1, 1100, 'NA1_anchor_new', $3, 'snapshot', TRUE, $3),
         ($1, 1200, NULL, NULL, 'snapshot', NULL, NOW())`,
      [playerId, olderAnchorAt, newerAnchorAt],
    );

    mockRiotFetchWith({
      accountBody: { puuid: "puuid-sparse", gameName: "SparseSwing", tagLine: "NA1" },
      matchIdsBody: ["NA1_402", "NA1_401"],
    });

    const refresh = await request(app).get("/api/player/SparseSwing/NA1?includeHistory=1&limit=20&refresh=1");
    expect(refresh.status).toBe(200);

    const rows = await getPool().query<{ match_id: string; score: number | null; source: string }>(
      `SELECT match_id, score, source
       FROM score_snapshots
       WHERE player_id = $1
         AND match_id IN ('NA1_402', 'NA1_401')
       ORDER BY game_ended_at DESC`,
      [playerId],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0]?.source).toBe("confirmed");
    expect(rows.rows[1]?.source).toBe("estimated");
    expect(rows.rows[0]?.score).not.toBeNull();
    expect(rows.rows[1]?.score).not.toBeNull();

    const newestScore = rows.rows[0]?.score ?? 0;
    const previousScore = rows.rows[1]?.score ?? 0;
    expect(Math.abs(newestScore - previousScore)).toBeLessThanOrEqual(40);
  });

  it("rounds decimal match snapshot scores before persistence", async () => {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('DecimalScore', 'NA1', 'puuid-decimal-score', 'na1')
       RETURNING player_id`,
    );
    const playerId = inserted.rows[0].player_id;

    const snapshot = await recordMatchScoreSnapshot({
      playerId,
      matchId: "NA1_decimal_rounding",
      score: 718.0793650793651,
      gameEndedAt: new Date(),
      source: "estimated",
      won: true,
      championName: "Ahri",
      queueId: 420,
    });

    expect(snapshot.score).toBe(718);

    const stored = await getPool().query<{ score: number | null }>(
      `SELECT score
       FROM score_snapshots
       WHERE player_id = $1
         AND match_id = $2`,
      [playerId, "NA1_decimal_rounding"],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]?.score).toBe(718);
  });

  it("does not write empty snapshots for unranked players without ranked matches", async () => {
    mockRiotFetchWith({
      accountBody: { puuid: "puuid-unranked-empty", gameName: "NoSoloRank", tagLine: "NA1" },
      matchIdsBody: [],
      leagueBody: [],
    });

    const firstRefresh = await request(app).get("/api/player/NoSoloRank/NA1?includeHistory=1&limit=20&refresh=1");
    expect(firstRefresh.status).toBe(200);
    expect(Array.isArray(firstRefresh.body.history)).toBe(true);
    expect(firstRefresh.body.history).toHaveLength(0);

    const playerRows = await getPool().query<{ player_id: number }>(
      `SELECT player_id
       FROM players
       WHERE puuid = 'puuid-unranked-empty' AND platform = 'na1'`,
    );
    expect(playerRows.rowCount).toBe(1);
    const playerId = playerRows.rows[0].player_id;

    const snapshotRows = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM score_snapshots
       WHERE player_id = $1`,
      [playerId],
    );
    expect(Number(snapshotRows.rows[0].count)).toBe(0);

    mockRiotFetchWith({
      accountBody: { puuid: "puuid-unranked-empty", gameName: "NoSoloRank", tagLine: "NA1" },
      matchIdsBody: [],
      leagueBody: [],
    });
    const secondRefresh = await request(app).get("/api/player/NoSoloRank/NA1?includeHistory=1&limit=20&refresh=1");
    expect(secondRefresh.status).toBe(200);

    const snapshotRowsAfterSecond = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM score_snapshots
       WHERE player_id = $1`,
      [playerId],
    );
    expect(Number(snapshotRowsAfterSecond.rows[0].count)).toBe(0);
  });

  it("does not sync snapshot-only players unless refresh is requested", async () => {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('YaBoiPatu', 'NA1', 'puuid-yaboi', 'na1')
       RETURNING player_id`,
    );
    const playerId = inserted.rows[0].player_id;

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW())`,
      [playerId, 1200],
    );

    mockRiotFetchWith({
      accountBody: { puuid: "puuid-yaboi", gameName: "YaBoiPatu", tagLine: "NA1" },
      matchIdsBody: ["NA1_22", "NA1_21"],
    });

    const noRefresh = await request(app).get("/api/player/YaBoiPatu/NA1?includeHistory=1&limit=20");
    expect(noRefresh.status).toBe(200);
    expect(Array.isArray(noRefresh.body.history)).toBe(true);
    expect(noRefresh.body.history).toHaveLength(1);

    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(0);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(0);

    mockRiotFetchWith({
      accountBody: { puuid: "puuid-yaboi", gameName: "YaBoiPatu", tagLine: "NA1" },
      matchIdsBody: ["NA1_22", "NA1_21"],
    });
    const refresh = await request(app).get("/api/player/YaBoiPatu/NA1?includeHistory=1&limit=20&refresh=1");
    expect(refresh.status).toBe(200);
    expect(Array.isArray(refresh.body.history)).toBe(true);
    expect(refresh.body.history.length).toBeGreaterThanOrEqual(2);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(2);
  });

  it("is idempotent across repeated refreshes with same latest matches", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2", "NA1_1"],
    });
    const first = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=20");
    expect(first.status).toBe(200);

    const firstCountRows = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM score_snapshots
       WHERE match_id IS NOT NULL`,
    );
    const firstCount = Number(firstCountRows.rows[0].count);

    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2", "NA1_1"],
    });
    const second = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=20&refresh=1");
    expect(second.status).toBe(200);

    const secondCountRows = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM score_snapshots
       WHERE match_id IS NOT NULL`,
    );
    const secondCount = Number(secondCountRows.rows[0].count);
    expect(secondCount).toBe(firstCount);
  });

  it("snapshots latest lobby players without recursive match sync", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_100"],
      matchById: {
        NA1_100: {
          metadata: { matchId: "NA1_100" },
          info: {
            gameEndTimestamp: Date.now() - 24 * 60 * 60 * 1000,
            queueId: 420,
            participants: [
              {
                puuid: "puuid-1",
                win: true,
                championName: "Ahri",
                riotIdGameName: "Faker",
                riotIdTagline: "KR1",
              },
              {
                puuid: "puuid-2",
                win: false,
                championName: "Garen",
                riotIdGameName: "DuoOne",
                riotIdTagline: "NA1",
              },
              {
                puuid: "puuid-3",
                win: false,
                championName: "Lux",
                riotIdGameName: "DuoTwo",
                riotIdTagline: "NA1",
              },
            ],
          },
        },
      },
    });

    const refresh = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=20");
    expect(refresh.status).toBe(200);

    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_100/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/league\/v4\/entries\/by-puuid\//)).toBe(3);

    const playerCountRows = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM players`,
    );
    expect(Number(playerCountRows.rows[0].count)).toBe(3);

    const breadthRows = await getPool().query<
      { match_id: string | null; game_ended_at: Date | null; queue_id: number | null; won: boolean | null }
    >(
      `SELECT match_id, game_ended_at, queue_id, won
       FROM score_snapshots
       WHERE player_id IN (
         SELECT player_id FROM players
         WHERE LOWER(game_name) IN (LOWER('DuoOne'), LOWER('DuoTwo'))
       )`,
    );
    expect(breadthRows.rowCount).toBe(2);
    for (const row of breadthRows.rows) {
      expect(row.match_id).toBe("NA1_100");
      expect(row.game_ended_at).toBeTruthy();
      expect(row.queue_id).toBe(420);
      expect(typeof row.won).toBe("boolean");
    }
  });

  it("serves cached history without Riot calls when refresh is not requested", async () => {
    mockRiotFetchWith({
      matchIdsBody: ["NA1_7", "NA1_6"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(seeded.status).toBe(200);

    mockRiotFetchWith({
      throwError: new Error("Riot should not be called"),
    });
    const cached = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(cached.status).toBe(200);
    expect(Array.isArray(cached.body.history)).toBe(true);
    expect(cached.body.history.length).toBeGreaterThan(0);
  });

  it("maps Riot API failures and timeout-like failures", async () => {
    mockRiotFetchWith({
      accountStatus: 429,
      accountBody: { status: { status_code: 429 } },
    });
    const rateLimited = await request(app).get("/api/player/Busy/KR1");
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.body.error).toContain("account lookup failed");

    mockRiotFetchWith({ throwError: new Error("upstream timeout") });
    const timeoutLike = await request(app).get("/api/player/Timeout/KR1");
    expect(timeoutLike.status).toBe(500);
    expect(timeoutLike.body.error).toBe("Internal server error");
  });

  it("concurrent refreshes for the same player deduplicate Riot API sync work", async () => {
    // Seed the player so both concurrent requests resolve to the same player_id,
    // allowing the in-process single-flight map to kick in.
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3", "NA1_2"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=10");
    expect(seeded.status).toBe(200);

    // Fire two concurrent refreshes. Both use the same unique IP to stay in
    // the same rate-limit bucket (10/15 min) but far from the limit here.
    const syncIp = "10.11.12.13";
    mockRiotFetchWith({
      matchIdsBody: ["NA1_5", "NA1_4", "NA1_3", "NA1_2"],
    });

    const [r1, r2] = await Promise.all([
      request(app).get("/api/player/Faker/KR1?refresh=1").set("X-Forwarded-For", syncIp),
      request(app).get("/api/player/Faker/KR1?refresh=1").set("X-Forwarded-For", syncIp),
    ]);

    // Both requests should succeed.
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // The single-flight map should have coalesced the syncs: match-list and
    // match-detail calls should appear once for this sync burst.
    const matchListCalls = countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/);
    expect(matchListCalls).toBe(1);

    // Both responses should agree on the latest score.
    expect(r1.body.score).toBe(r2.body.score);
  });

  it("cold-cache concurrent refreshes deduplicate before account resolution", async () => {
    const syncIp = "10.21.22.23";
    mockRiotFetchWith({
      accountBody: { puuid: "puuid-cold", gameName: "ColdStart", tagLine: "NA1" },
      matchIdsBody: ["NA1_12", "NA1_11"],
    });

    const [r1, r2] = await Promise.all([
      request(app)
        .get("/api/player/ColdStart/NA1?includeHistory=1&refresh=1&limit=10")
        .set("X-Forwarded-For", syncIp),
      request(app)
        .get("/api/player/ColdStart/NA1?includeHistory=1&refresh=1&limit=10")
        .set("X-Forwarded-For", syncIp),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(countRiotFetchCalls(/\/riot\/account\/v1\/accounts\/by-riot-id\//)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/by-puuid\/.+\/ids/)).toBe(1);
    expect(countRiotFetchCalls(/\/lol\/match\/v5\/matches\/NA1_/)).toBe(2);
  });

  it("rejects invalid player limit query params", async () => {
    const invalidHistoryLimit = await request(app).get("/api/player/Faker/KR1/history?limit=-5");
    expect(invalidHistoryLimit.status).toBe(400);

    const invalidScoreLimit = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=abc");
    expect(invalidScoreLimit.status).toBe(400);
  });

  it("filters includeHistory responses to the S16 season window", async () => {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('SeasonTester', 'NA1', 'puuid-season-tester', 'na1')
       RETURNING player_id`,
    );
    const playerId = inserted.rows[0].player_id;

    const preseason = new Date("2026-01-16T23:59:59.000Z");
    const seasonStart = new Date(SEASON_16_START_ISO);
    const midSeason = new Date("2026-01-20T12:34:56.000Z");

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, match_id, game_ended_at, source, recorded_at)
       VALUES
         ($1, 1900, 'NA1_preseason', $2, 'confirmed', $2),
         ($1, 2100, 'NA1_s16_start', $3, 'confirmed', $3),
         ($1, 2300, 'NA1_s16_mid', $4, 'confirmed', $4)`,
      [playerId, preseason, seasonStart, midSeason],
    );

    const response = await request(app).get(
      `/api/player/SeasonTester/NA1?includeHistory=1&season=${SEASON_16_KEY}&limit=5000`,
    );
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.history)).toBe(true);
    expect(response.body.history).toHaveLength(2);
    expect(response.body.history[0]?.matchId).toBe("NA1_s16_start");
    expect(response.body.history[1]?.matchId).toBe("NA1_s16_mid");
  });

  it("returns empty S16 history without forcing Riot sync when only preseason data exists", async () => {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ('SeasonOldOnly', 'NA1', 'puuid-season-old-only', 'na1')
       RETURNING player_id`,
    );
    const playerId = inserted.rows[0].player_id;

    const preseason = new Date("2026-01-16T23:59:59.000Z");
    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, match_id, game_ended_at, source, recorded_at)
       VALUES ($1, 1800, 'NA1_preseason_only', $2, 'confirmed', $2)`,
      [playerId, preseason],
    );

    mockRiotFetchWith({ throwError: new Error("Riot should not be called") });
    const response = await request(app).get(
      `/api/player/SeasonOldOnly/NA1?includeHistory=1&season=${SEASON_16_KEY}&limit=5000`,
    );
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.history)).toBe(true);
    expect(response.body.history).toHaveLength(0);
  });

  it("rejects unsupported season query values", async () => {
    const invalidSeason = await request(app).get("/api/player/Faker/KR1?includeHistory=1&season=s15");
    expect(invalidSeason.status).toBe(400);
  });

  it("player refresh endpoint enforces per-IP rate limit", async () => {
    // Use a unique IP so this test does not consume from the shared rate-limit
    // bucket used by other tests in this suite.
    const uniqueIp = "10.44.55.66";

    // Seed the player once without refresh so no Riot calls are needed during
    // the rate-limit probing phase.
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3"],
    });
    const seeded = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=5");
    expect(seeded.status).toBe(200);

    // Allow up to 10 refresh requests (the configured limit), then expect 429.
    // Use a mock that throws so we can detect if Riot is called unexpectedly.
    mockRiotFetchWith({
      matchIdsBody: ["NA1_3"],
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .get("/api/player/Faker/KR1?refresh=1")
        .set("X-Forwarded-For", uniqueIp);
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 200).length).toBe(10);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
