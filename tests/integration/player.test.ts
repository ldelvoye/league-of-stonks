import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../backend/app.ts";
import { getPool } from "../../backend/db/index.ts";
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
});
