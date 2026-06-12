import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../backend/app.ts";
import {
  closeIntegrationDb,
  initIntegrationDb,
  resetIntegrationState,
} from "./helpers.ts";

describe("health route integration", () => {
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

  it("GET /health returns ok", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
