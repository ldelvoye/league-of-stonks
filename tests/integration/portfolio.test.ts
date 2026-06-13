import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../backend/app.ts";
import { getPool } from "../../backend/db/index.ts";
import * as emailLib from "../../backend/lib/email.ts";
import {
  TEST_PASSWORD,
  closeIntegrationDb,
  initIntegrationDb,
  resetIntegrationState,
  waitForCondition,
} from "./helpers.ts";

describe("portfolio routes integration", () => {
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

  async function registerAgent(
    agent: ReturnType<typeof request.agent>,
    username: string,
    email: string,
    { verify = true }: { verify?: boolean } = {},
  ): Promise<void> {
    const sentTokens: string[] = [];
    const sendVerificationSpy = vi
      .spyOn(emailLib, "sendVerificationEmail")
      .mockImplementation(async (_to, token) => {
        sentTokens.push(token);
      });

    const register = await agent.post("/api/auth/register").send({
      username,
      email,
      password: TEST_PASSWORD,
    });
    expect(register.status).toBe(201);

    if (!verify) {
      sendVerificationSpy.mockRestore();
      return;
    }

    await waitForCondition(() => sentTokens.length === 1);
    const verifyResponse = await request(app).post("/api/auth/verify-email").send({
      token: sentTokens[0],
    });
    expect(verifyResponse.status).toBe(200);
    sendVerificationSpy.mockRestore();
  }

  async function seedPlayerScore(
    gameName: string,
    tagLine: string,
    score: number | null,
  ): Promise<number> {
    const inserted = await getPool().query<{ player_id: number }>(
      `INSERT INTO players (game_name, tag_line, puuid, platform)
       VALUES ($1, $2, $3, 'na1')
       RETURNING player_id`,
      [gameName, tagLine, `puuid-${gameName}-${tagLine}`],
    );
    const playerId = inserted.rows[0].player_id;

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW())`,
      [playerId, score],
    );
    return playerId;
  }

  it("requires authentication", async () => {
    const portfolio = await request(app).get("/api/portfolio");
    expect(portfolio.status).toBe(401);

    const trade = await request(app).post("/api/portfolio/trades").send({
      gameName: "Faker",
      tagLine: "KR1",
      side: "buy",
      shares: "1",
    });
    expect(trade.status).toBe(401);
  });

  it("rejects authenticated but unverified users", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "needs_verify_user", "needs_verify_user@example.com", { verify: false });
    await seedPlayerScore("Faker", "KR1", 1500);

    const portfolio = await agent.get("/api/portfolio");
    expect(portfolio.status).toBe(403);
    expect(portfolio.body.error).toContain("Verify your email");

    const trade = await agent.post("/api/portfolio/trades").send({
      gameName: "Faker",
      tagLine: "KR1",
      side: "buy",
      shares: "1",
    });
    expect(trade.status).toBe(403);
    expect(trade.body.error).toContain("Verify your email");
  });

  it("returns the seeded starting portfolio for a newly registered user", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "portfolio_user", "portfolio_user@example.com");

    const portfolio = await agent.get("/api/portfolio");
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.lpBalance).toBe("50000.00");
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.trades).toEqual([]);
  });

  it("executes a fractional buy trade and updates holdings", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "buyer_user", "buyer_user@example.com");
    await seedPlayerScore("Faker", "KR1", 1500);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "Faker",
      tagLine: "KR1",
      side: "buy",
      shares: "1.25",
    });

    expect(buy.status).toBe(201);
    expect(buy.body.trade.side).toBe("buy");
    expect(buy.body.trade.shares).toBe("1.250");
    expect(buy.body.trade.pricePerShare).toBe("1500.00");
    expect(buy.body.trade.totalValue).toBe("1875.00");
    expect(buy.body.portfolio.lpBalance).toBe("48125.00");
    expect(buy.body.portfolio.positions).toHaveLength(1);
    expect(buy.body.portfolio.trades).toHaveLength(1);

    const position = buy.body.portfolio.positions[0];
    expect(position.gameName).toBe("Faker");
    expect(position.tagLine).toBe("KR1");
    expect(position.shares).toBe("1.250");
    expect(position.avgCost).toBe("1500.00");
    expect(position.currentPrice).toBe("1500.00");
    expect(position.totalCost).toBe("1875.00");
    expect(position.marketValue).toBe("1875.00");
    expect(position.unrealizedGain).toBe("0.00");
  });

  it("executes a sell trade and keeps average cost for remaining shares", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "seller_user", "seller_user@example.com");
    const playerId = await seedPlayerScore("SoldPlayer", "NA1", 1500);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "SoldPlayer",
      tagLine: "NA1",
      side: "buy",
      shares: "2",
    });
    expect(buy.status).toBe(201);

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW() + INTERVAL '1 minute')`,
      [playerId, 1800],
    );

    const sell = await agent.post("/api/portfolio/trades").send({
      gameName: "SoldPlayer",
      tagLine: "NA1",
      side: "sell",
      shares: "0.5",
    });

    expect(sell.status).toBe(201);
    expect(sell.body.trade.side).toBe("sell");
    expect(sell.body.trade.shares).toBe("0.500");
    expect(sell.body.trade.pricePerShare).toBe("1800.00");
    expect(sell.body.trade.totalValue).toBe("900.00");
    expect(sell.body.portfolio.lpBalance).toBe("47900.00");
    expect(sell.body.portfolio.trades).toHaveLength(2);
    expect(sell.body.portfolio.trades[0].side).toBe("sell");

    const position = sell.body.portfolio.positions[0];
    expect(position.shares).toBe("1.500");
    expect(position.avgCost).toBe("1500.00");
    expect(position.currentPrice).toBe("1800.00");
    expect(position.totalCost).toBe("2250.00");
    expect(position.marketValue).toBe("2700.00");
    expect(position.unrealizedGain).toBe("450.00");
    expect(position.unrealizedGainPct).toBe("20.0000");
  });

  it("rejects buy orders that exceed available balance", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "low_cash_user", "low_cash_user@example.com");
    await seedPlayerScore("Expensive", "NA1", 30000);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "Expensive",
      tagLine: "NA1",
      side: "buy",
      shares: "2",
    });
    expect(buy.status).toBe(400);
    expect(buy.body.error).toContain("Insufficient available balance");
  });

  it("rejects buy orders with more than 3 decimal places of shares", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "precision_user", "precision_user@example.com");
    await seedPlayerScore("Precise", "NA1", 1000);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "Precise",
      tagLine: "NA1",
      side: "buy",
      shares: "1.2345",
    });
    expect(buy.status).toBe(400);
    expect(buy.body.error).toContain("positive shares value");
  });

  it("rejects sell orders that exceed owned shares", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "short_sell_user", "short_sell_user@example.com");
    await seedPlayerScore("Holder", "NA1", 1000);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "Holder",
      tagLine: "NA1",
      side: "buy",
      shares: "0.5",
    });
    expect(buy.status).toBe(201);

    const sell = await agent.post("/api/portfolio/trades").send({
      gameName: "Holder",
      tagLine: "NA1",
      side: "sell",
      shares: "1",
    });
    expect(sell.status).toBe(400);
    expect(sell.body.error).toContain("Insufficient shares");
  });

  it("rejects trading players without a priced rank snapshot", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "unranked_user", "unranked_user@example.com");
    await seedPlayerScore("Unranked", "NA1", null);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "Unranked",
      tagLine: "NA1",
      side: "buy",
      shares: "1",
    });
    expect(buy.status).toBe(400);
    expect(buy.body.error).toContain("cannot be traded");
  });
});
