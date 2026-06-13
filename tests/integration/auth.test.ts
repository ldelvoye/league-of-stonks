import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../backend/app.ts";
import { getPool } from "../../backend/db/index.ts";
import * as emailLib from "../../backend/lib/email.ts";
import { resetAuthRateLimitsForTests } from "../../backend/routes/auth.ts";
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
    resetAuthRateLimitsForTests();
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
      username: "user1",
      email: "user1@example.com",
      password: TEST_PASSWORD,
    });
    expect(register.status).toBe(201);
    expect(register.body.username).toBe("user1");
    expect(register.body.emailVerified).toBe(false);
    const portfolioResult = await getPool().query<{ lp_balance: string }>(
      `SELECT lp_balance FROM portfolios WHERE user_id = $1`,
      [register.body.userId as number],
    );
    expect(portfolioResult.rows).toHaveLength(1);
    expect(portfolioResult.rows[0].lp_balance).toBe("50000.00");

    await waitForCondition(() => sentTokens.length === 1);
    const firstToken = sentTokens[0];

    const meBefore = await agent.get("/api/auth/me");
    expect(meBefore.status).toBe(200);
    expect(meBefore.body.username).toBe("user1");
    expect(meBefore.body.email).toBe("user1@example.com");
    expect(meBefore.body.emailVerified).toBe(false);

    const verify = await request(app).post("/api/auth/verify-email").send({ token: firstToken });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ ok: true });
    const verifyAgain = await request(app).post("/api/auth/verify-email").send({ token: firstToken });
    expect(verifyAgain.status).toBe(200);
    expect(verifyAgain.body).toEqual({ ok: true });

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
      identifier: "user1",
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.emailVerified).toBe(true);
    expect(login.body.username).toBe("user1");
  });

  it("resend invalidates old tokens only after successful send", async () => {
    const sentTokens: string[] = [];
    vi.spyOn(emailLib, "sendVerificationEmail").mockImplementation(async (_to, token) => {
      sentTokens.push(token);
    });

    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({
      username: "user2",
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
      username: "user3",
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

  it("supports forgot-password and reset-password flow", async () => {
    const sentResetTokens: string[] = [];
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async (_to, token) => {
      sentResetTokens.push(token);
    });

    await request(app).post("/api/auth/register").send({
      username: "resetuser",
      email: "resetuser@example.com",
      password: TEST_PASSWORD,
    });

    const forgot = await request(app).post("/api/auth/forgot-password").send({
      email: "resetuser@example.com",
    });
    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual({ ok: true });
    await waitForCondition(() => sentResetTokens.length === 1);

    const reset = await request(app).post("/api/auth/reset-password").send({
      token: sentResetTokens[0],
      password: "newpassword123",
    });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true });

    const oldLogin = await request(app).post("/api/auth/login").send({
      identifier: "resetuser",
      password: TEST_PASSWORD,
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post("/api/auth/login").send({
      identifier: "resetuser@example.com",
      password: "newpassword123",
    });
    expect(newLogin.status).toBe(200);
  });

  it("updates account profile with current password and re-verifies changed email", async () => {
    const sentTokens: string[] = [];
    vi.spyOn(emailLib, "sendVerificationEmail").mockImplementation(async (_to, token) => {
      sentTokens.push(token);
    });

    const agent = request.agent(app);
    const register = await agent.post("/api/auth/register").send({
      username: "profileuser",
      email: "profileuser@example.com",
      password: TEST_PASSWORD,
    });
    expect(register.status).toBe(201);
    await waitForCondition(() => sentTokens.length === 1);
    const registrationToken = sentTokens[0];
    const verifyRegistration = await request(app).post("/api/auth/verify-email").send({
      token: registrationToken,
    });
    expect(verifyRegistration.status).toBe(200);
    sentTokens.length = 0;

    const wrongPassword = await agent.post("/api/auth/update-profile").send({
      username: "profileuser2",
      email: "profileuser2@example.com",
      password: "wrong-password",
    });
    expect(wrongPassword.status).toBe(401);

    const noOp = await agent.post("/api/auth/update-profile").send({
      username: "profileuser",
      email: "profileuser@example.com",
      password: TEST_PASSWORD,
    });
    expect(noOp.status).toBe(400);
    expect(noOp.body.error).toContain("No profile changes submitted");

    const updated = await agent.post("/api/auth/update-profile").send({
      username: "profileuser2",
      email: "profileuser2@example.com",
      password: TEST_PASSWORD,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.username).toBe("profileuser2");
    expect(updated.body.email).toBe("profileuser@example.com");
    expect(updated.body.emailVerified).toBe(true);

    await waitForCondition(() => sentTokens.length === 1);
    const verify = await request(app).post("/api/auth/verify-email").send({
      token: sentTokens[0],
    });
    expect(verify.status).toBe(200);

    const meAfterVerify = await agent.get("/api/auth/me");
    expect(meAfterVerify.status).toBe(200);
    expect(meAfterVerify.body.username).toBe("profileuser2");
    expect(meAfterVerify.body.email).toBe("profileuser2@example.com");
    expect(meAfterVerify.body.emailVerified).toBe(true);
  });

  it("enforces once-per-day cooldown on username and email changes", async () => {
    const sentTokens: string[] = [];
    vi.spyOn(emailLib, "sendVerificationEmail").mockImplementation(async (_to, token) => {
      sentTokens.push(token);
    });

    const agent = request.agent(app);
    const register = await agent.post("/api/auth/register").send({
      username: "cooldownuser",
      email: "cooldownuser@example.com",
      password: TEST_PASSWORD,
    });
    expect(register.status).toBe(201);
    await waitForCondition(() => sentTokens.length === 1);
    const verifyRegistration = await request(app).post("/api/auth/verify-email").send({
      token: sentTokens[0],
    });
    expect(verifyRegistration.status).toBe(200);
    sentTokens.length = 0;

    const firstUsernameChange = await agent.post("/api/auth/update-profile").send({
      username: "cooldownuser2",
      email: "cooldownuser@example.com",
      password: TEST_PASSWORD,
    });
    expect(firstUsernameChange.status).toBe(200);
    const secondUsernameChange = await agent.post("/api/auth/update-profile").send({
      username: "cooldownuser3",
      email: "cooldownuser@example.com",
      password: TEST_PASSWORD,
    });
    expect(secondUsernameChange.status).toBe(429);
    expect(secondUsernameChange.body.error).toContain("Username can only be changed once every 24 hours");

    const statusAfterUsernameChange = await agent.get("/api/auth/profile-change-status");
    expect(statusAfterUsernameChange.status).toBe(200);
    expect(statusAfterUsernameChange.body.username.allowed).toBe(false);
    expect(statusAfterUsernameChange.body.username.message).toContain(
      "Username can only be changed once every 24 hours",
    );

    const firstEmailChange = await agent.post("/api/auth/update-profile").send({
      username: "cooldownuser2",
      email: "cooldownuser2@example.com",
      password: TEST_PASSWORD,
    });
    expect(firstEmailChange.status).toBe(200);
    await waitForCondition(() => sentTokens.length === 1);

    const secondEmailChange = await agent.post("/api/auth/update-profile").send({
      username: "cooldownuser2",
      email: "cooldownuser3@example.com",
      password: TEST_PASSWORD,
    });
    expect(secondEmailChange.status).toBe(429);
    expect(secondEmailChange.body.error).toContain("Email can only be changed once every 24 hours");

    const statusAfterEmailChange = await agent.get("/api/auth/profile-change-status");
    expect(statusAfterEmailChange.status).toBe(200);
    expect(statusAfterEmailChange.body.email.allowed).toBe(false);
    expect(statusAfterEmailChange.body.email.message).toContain(
      "Email can only be changed once every 24 hours",
    );
  });

  it("sends password reset link from authenticated account action", async () => {
    const sentResetTokens: string[] = [];
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async (_to, token) => {
      sentResetTokens.push(token);
    });

    const agent = request.agent(app);
    const register = await agent.post("/api/auth/register").send({
      username: "pwrequser",
      email: "pwreq@example.com",
      password: TEST_PASSWORD,
    });
    expect(register.status).toBe(201);

    const requestReset = await agent.post("/api/auth/request-password-reset");
    expect(requestReset.status).toBe(200);
    expect(requestReset.body).toEqual({ ok: true });
    await waitForCondition(() => sentResetTokens.length === 1);
  });

  it("handles attack-style auth abuse with route limits and invalid input", async () => {
    const badEmail = await request(app).post("/api/auth/register").send({
      username: "user4",
      email: "not-an-email",
      password: TEST_PASSWORD,
    });
    expect(badEmail.status).toBe(400);

    const registered = await request(app).post("/api/auth/register").send({
      username: "user4",
      email: "user4@example.com",
      password: TEST_PASSWORD,
    });
    expect(registered.status).toBe(201);

    const wrongPassword = await request(app).post("/api/auth/login").send({
      identifier: "user4@example.com",
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
      username: "user5",
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
        username: `attacker_${i}`,
        email: `attacker${i}@example.com`,
        password: TEST_PASSWORD,
      });
      bruteStatuses.push(res.status);
    }
    expect(bruteStatuses.some((status) => status === 429)).toBe(true);
  });
});
