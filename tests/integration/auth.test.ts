import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../backend/app.ts";
import * as emailLib from "../../backend/lib/email.ts";
import {
  TEST_PASSWORD,
  closeIntegrationDb,
  initIntegrationDb,
  resetIntegrationState,
  waitForCondition,
} from "./helpers.ts";

describe("auth routes integration", () => {
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

  it("covers auth happy path and verification flow", async () => {
    const sentTokens: string[] = [];
    vi.spyOn(emailLib, "sendVerificationEmail").mockImplementation(async (_to, token) => {
      sentTokens.push(token);
    });

    const agent = request.agent(app);
    const register = await agent.post("/api/auth/register").send({
      email: "user1@example.com",
      password: TEST_PASSWORD,
    });
    expect(register.status).toBe(201);
    expect(register.body.emailVerified).toBe(false);

    await waitForCondition(() => sentTokens.length === 1);
    const firstToken = sentTokens[0];

    const meBefore = await agent.get("/api/auth/me");
    expect(meBefore.status).toBe(200);
    expect(meBefore.body.email).toBe("user1@example.com");
    expect(meBefore.body.emailVerified).toBe(false);

    const verify = await request(app).post("/api/auth/verify-email").send({ token: firstToken });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ ok: true });

    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.emailVerified).toBe(true);
    expect(typeof meAfter.body.emailVerifiedAt).toBe("string");

    const resendWhenVerified = await agent.post("/api/auth/resend-verification");
    expect(resendWhenVerified.status).toBe(400);
    expect(resendWhenVerified.body.error).toContain("already verified");

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);

    const meAfterLogout = await agent.get("/api/auth/me");
    expect(meAfterLogout.status).toBe(401);

    const login = await agent.post("/api/auth/login").send({
      email: "user1@example.com",
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.emailVerified).toBe(true);
  });

  it("resend invalidates old tokens only after successful send", async () => {
    const sentTokens: string[] = [];
    vi.spyOn(emailLib, "sendVerificationEmail").mockImplementation(async (_to, token) => {
      sentTokens.push(token);
    });

    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({
      email: "user2@example.com",
      password: TEST_PASSWORD,
    });
    await waitForCondition(() => sentTokens.length === 1);

    const resend = await agent.post("/api/auth/resend-verification");
    expect(resend.status).toBe(200);
    await waitForCondition(() => sentTokens.length === 2);

    const [oldToken, newToken] = sentTokens;
    const oldTokenVerify = await request(app).post("/api/auth/verify-email").send({ token: oldToken });
    expect(oldTokenVerify.status).toBe(400);

    const newTokenVerify = await request(app).post("/api/auth/verify-email").send({ token: newToken });
    expect(newTokenVerify.status).toBe(200);
  });

  it("preserves old verification token if resend email delivery fails", async () => {
    const sentTokens: string[] = [];
    const sendSpy = vi
      .spyOn(emailLib, "sendVerificationEmail")
      .mockImplementation(async (_to, token) => {
        sentTokens.push(token);
      });

    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({
      email: "user3@example.com",
      password: TEST_PASSWORD,
    });
    await waitForCondition(() => sentTokens.length === 1);
    const originalToken = sentTokens[0];

    sendSpy.mockRejectedValueOnce(new Error("Resend provider timeout"));
    const resend = await agent.post("/api/auth/resend-verification");
    expect(resend.status).toBeGreaterThanOrEqual(500);

    const verifyOriginal = await request(app).post("/api/auth/verify-email").send({ token: originalToken });
    expect(verifyOriginal.status).toBe(200);
  });

  it("handles attack-style auth abuse with route limits and invalid input", async () => {
    const badEmail = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      password: TEST_PASSWORD,
    });
    expect(badEmail.status).toBe(400);

    const registered = await request(app).post("/api/auth/register").send({
      email: "user4@example.com",
      password: TEST_PASSWORD,
    });
    expect(registered.status).toBe(201);

    const wrongPassword = await request(app).post("/api/auth/login").send({
      email: "user4@example.com",
      password: "wrong-password",
    });
    expect(wrongPassword.status).toBe(401);

    const verifyStatuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: `invalid-token-${i}` });
      verifyStatuses.push(res.status);
    }
    expect(verifyStatuses.some((status) => status === 429)).toBe(true);

    const sentTokens: string[] = [];
    vi.spyOn(emailLib, "sendVerificationEmail").mockImplementation(async (_to, token) => {
      sentTokens.push(token);
    });

    const resendAgent = request.agent(app);
    const resendUserRegister = await resendAgent.post("/api/auth/register").send({
      email: "user5@example.com",
      password: TEST_PASSWORD,
    });
    expect(resendUserRegister.status).toBe(201);
    await waitForCondition(() => sentTokens.length === 1);

    const resendStatuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await resendAgent.post("/api/auth/resend-verification");
      resendStatuses.push(res.status);
    }
    expect(resendStatuses.some((status) => status === 429)).toBe(true);

    const bruteStatuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app).post("/api/auth/register").send({
        email: `attacker${i}@example.com`,
        password: TEST_PASSWORD,
      });
      bruteStatuses.push(res.status);
    }
    expect(bruteStatuses.some((status) => status === 429)).toBe(true);
  });
});
