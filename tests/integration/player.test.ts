import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../backend/app.ts";
import {
  closeIntegrationDb,
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

  it("covers player routes with Riot API mocked", async () => {
    mockRiotFetchWith();

    const score = await request(app).get("/api/player/Faker/KR1");
    expect(score.status).toBe(200);
    expect(score.body).toEqual({ score: 1450 });

    const scoreAndHistory = await request(app).get("/api/player/Faker/KR1?includeHistory=1&limit=5");
    expect(scoreAndHistory.status).toBe(200);
    expect(scoreAndHistory.body.gameName).toBe("Faker");
    expect(scoreAndHistory.body.tagLine).toBe("KR1");
    expect(Array.isArray(scoreAndHistory.body.history)).toBe(true);
    expect(scoreAndHistory.body.history.length).toBeGreaterThan(0);

    const history = await request(app).get("/api/player/Faker/KR1/history?limit=5");
    expect(history.status).toBe(200);
    expect(history.body.gameName).toBe("Faker");
    expect(history.body.tagLine).toBe("KR1");
    expect(Array.isArray(history.body.history)).toBe(true);
    expect(history.body.history.length).toBeGreaterThan(0);
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
