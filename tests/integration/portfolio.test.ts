import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../backend/app.ts";
import { getPool } from "../../backend/db/index.ts";
import { recordScoreSnapshot } from "../../backend/db/tables/scores.ts";
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
    // Use the application-level function so player_latest_scores stays in sync.
    await recordScoreSnapshot(playerId, score);
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
      expectedPricePerShare: "1500.00",
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
      expectedPricePerShare: "1500.00",
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
      expectedPricePerShare: "1500.00",
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
      expectedPricePerShare: "1500.00",
    });
    expect(buy.status).toBe(201);

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW() + INTERVAL '1 minute')`,
      [playerId, 1800],
    );
    // Sync player_latest_scores to reflect the updated score.
    await getPool().query(
      `INSERT INTO player_latest_scores (player_id, score, recorded_at, source, updated_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 minute', 'snapshot', NOW())
       ON CONFLICT (player_id) DO UPDATE
         SET score       = EXCLUDED.score,
             recorded_at = EXCLUDED.recorded_at,
             source      = EXCLUDED.source,
             updated_at  = NOW()
         WHERE player_latest_scores.recorded_at <= EXCLUDED.recorded_at`,
      [playerId, 1800],
    );

    const sell = await agent.post("/api/portfolio/trades").send({
      gameName: "SoldPlayer",
      tagLine: "NA1",
      side: "sell",
      shares: "0.5",
      expectedPricePerShare: "1800.00",
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
      expectedPricePerShare: "30000.00",
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
      expectedPricePerShare: "1000.00",
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
      expectedPricePerShare: "1000.00",
    });
    expect(buy.status).toBe(201);

    const sell = await agent.post("/api/portfolio/trades").send({
      gameName: "Holder",
      tagLine: "NA1",
      side: "sell",
      shares: "1",
      expectedPricePerShare: "1000.00",
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
      expectedPricePerShare: "1000.00",
    });
    expect(buy.status).toBe(400);
    expect(buy.body.error).toContain("cannot be traded");
  });

  it("rejects trades when the client price is stale", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "stale_price_user", "stale_price_user@example.com");
    const playerId = await seedPlayerScore("StalePrice", "NA1", 1500);

    await getPool().query(
      `INSERT INTO score_snapshots (player_id, score, source, recorded_at)
       VALUES ($1, $2, 'snapshot', NOW() + INTERVAL '1 minute')`,
      [playerId, 1800],
    );
    await getPool().query(
      `INSERT INTO player_latest_scores (player_id, score, recorded_at, source, updated_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 minute', 'snapshot', NOW())
       ON CONFLICT (player_id) DO UPDATE
         SET score       = EXCLUDED.score,
             recorded_at = EXCLUDED.recorded_at,
             source      = EXCLUDED.source,
             updated_at  = NOW()
         WHERE player_latest_scores.recorded_at <= EXCLUDED.recorded_at`,
      [playerId, 1800],
    );

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "StalePrice",
      tagLine: "NA1",
      side: "buy",
      shares: "1",
      expectedPricePerShare: "1500.00",
    });
    expect(buy.status).toBe(409);
    expect(buy.body.error).toContain("price per share has changed");
    expect(buy.body.error).toContain("Refresh");
  });

  it("concurrent sells cannot oversell shares beyond owned position", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "concurrent_sell_user", "concurrent_sell@example.com");
    await seedPlayerScore("ConcurrentSellTarget", "NA1", 1000);

    const buy = await agent.post("/api/portfolio/trades").send({
      gameName: "ConcurrentSellTarget",
      tagLine: "NA1",
      side: "buy",
      shares: "1",
      expectedPricePerShare: "1000.00",
    });
    expect(buy.status).toBe(201);

    // Two concurrent sells for 0.75 each (total 1.5) but only 1 share owned.
    // Exactly one must succeed and one must fail.
    const [sell1, sell2] = await Promise.all([
      agent.post("/api/portfolio/trades").send({
        gameName: "ConcurrentSellTarget",
        tagLine: "NA1",
        side: "sell",
        shares: "0.75",
        expectedPricePerShare: "1000.00",
      }),
      agent.post("/api/portfolio/trades").send({
        gameName: "ConcurrentSellTarget",
        tagLine: "NA1",
        side: "sell",
        shares: "0.75",
        expectedPricePerShare: "1000.00",
      }),
    ]);

    const statuses = [sell1.status, sell2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 400]);

    // One sell of 0.75 shares at 1000 LP went through.
    // Balance: 50000 - 1000 (buy) + 750 (sell) = 49750.
    const portfolio = await agent.get("/api/portfolio");
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.lpBalance).toBe("49750.00");
    expect(portfolio.body.positions).toHaveLength(1);
    expect(portfolio.body.positions[0].shares).toBe("0.250");
  });

  it("concurrent buys cannot overdraw available balance", async () => {
    const agent = request.agent(app);
    await registerAgent(agent, "concurrent_buy_user", "concurrent_buy@example.com");
    // 40000 LP per share; each buy is within the 50000 balance, but two together are not.
    await seedPlayerScore("ExpensiveConcurrent", "NA1", 40000);

    const [buy1, buy2] = await Promise.all([
      agent.post("/api/portfolio/trades").send({
        gameName: "ExpensiveConcurrent",
        tagLine: "NA1",
        side: "buy",
        shares: "1",
        expectedPricePerShare: "40000.00",
      }),
      agent.post("/api/portfolio/trades").send({
        gameName: "ExpensiveConcurrent",
        tagLine: "NA1",
        side: "buy",
        shares: "1",
        expectedPricePerShare: "40000.00",
      }),
    ]);

    const statuses = [buy1.status, buy2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 400]);

    // Exactly one buy went through: 50000 - 40000 = 10000 remaining.
    const portfolio = await agent.get("/api/portfolio");
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.lpBalance).toBe("10000.00");
    expect(portfolio.body.positions).toHaveLength(1);
    expect(portfolio.body.positions[0].shares).toBe("1.000");
  });
});
