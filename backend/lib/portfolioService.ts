import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/index.js";
import {
  deletePortfolioPosition,
  findPortfolioPosition,
  listPortfolioPositionsWithMarket,
  upsertPortfolioPosition,
  type SparklinePoint,
} from "../db/tables/portfolioPositions.js";
import {
  createPortfolioTrade,
  listPortfolioTradesWithPlayer,
  type PortfolioTradeSide,
} from "../db/tables/portfolioTrades.js";
import { findPortfolioByUserId } from "../db/tables/portfolios.js";
import { findPlayerByRiotId } from "../db/tables/players.js";
import { getLatestConfirmedMatchId } from "../db/tables/scores.js";
import {
  PORTFOLIO_CONFLICT_CODES,
  type PortfolioConflictCode,
} from "./portfolioConflictCodes.js";
import { getPlayerScore } from "./playerService.js";

type Queryable = Pick<Pool | PoolClient, "query">;

const SHARES_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;
const PRICE_PER_SHARE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const TRADE_HISTORY_LIMIT = 40;

export const PRICE_CHANGED_MESSAGE =
  "Price changed while processing your order. Review the updated price and try again.";
export const SHARE_HISTORY_CHANGED_MESSAGE =
  "Share history changed while processing your order. Review the updated history and try again.";

export type PortfolioServiceErrorCode = PortfolioConflictCode;

export class PortfolioServiceError extends Error {
  status: number;
  code: PortfolioServiceErrorCode | null;

  constructor(status: number, message: string, code: PortfolioServiceErrorCode | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "PortfolioServiceError";
  }
}

export interface PortfolioPositionSnapshot {
  playerId: number;
  gameName: string;
  tagLine: string;
  platform: string;
  shares: string;
  avgCost: string;
  currentPrice: string | null;
  totalCost: string;
  marketValue: string | null;
  unrealizedGain: string | null;
  unrealizedGainPct: string | null;
  sparklineHistory: SparklinePoint[];
}

export interface PortfolioTradeSnapshot {
  tradeId: number;
  playerId: number;
  gameName: string;
  tagLine: string;
  platform: string;
  side: PortfolioTradeSide;
  shares: string;
  pricePerShare: string;
  totalValue: string;
  executedAt: string;
}

export interface PortfolioSnapshot {
  portfolioId: number;
  userId: number;
  lpBalance: string;
  positions: PortfolioPositionSnapshot[];
  trades: PortfolioTradeSnapshot[];
}

export interface ExecutePortfolioTradeInput {
  userId: number;
  gameName: string;
  tagLine: string;
  platform: string;
  side: PortfolioTradeSide;
  shares: string;
  expectedPricePerShare: string;
}

export interface ExecutePortfolioTradeResult {
  trade: PortfolioTradeSnapshot;
  portfolio: PortfolioSnapshot;
}

interface LockedPortfolio {
  portfolioId: number;
  lpBalance: string;
}

interface BuyPositionResult {
  shares: string;
  avgCost: string;
}

export function normalizeSharesInput(value: unknown): string | null {
  let raw: string;
  if (typeof value === "string") {
    raw = value.trim();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    raw = value.toString();
  } else {
    return null;
  }

  if (!SHARES_PATTERN.test(raw)) return null;
  if (Number(raw) <= 0) return null;
  return raw;
}

export function normalizePricePerShareInput(value: unknown): string | null {
  let raw: string;
  if (typeof value === "string") {
    raw = value.trim();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    raw = value.toString();
  } else {
    return null;
  }

  if (!PRICE_PER_SHARE_PATTERN.test(raw)) return null;
  if (Number(raw) < 0) return null;
  return toMoneyString(Number(raw));
}

function toMoneyString(value: number): string {
  return value.toFixed(2);
}

async function compareNumeric(db: Queryable, left: string, right: string): Promise<number> {
  const { rows } = await db.query<{ cmp: number }>(
    `SELECT
       CASE
         WHEN $1::numeric < $2::numeric THEN -1
         WHEN $1::numeric > $2::numeric THEN 1
         ELSE 0
       END AS cmp`,
    [left, right],
  );
  return rows[0].cmp;
}

async function multiplyToMoney(db: Queryable, left: string, right: string): Promise<string> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT
       ROUND(($1::numeric * $2::numeric), 2)::numeric(18,2)::text AS value`,
    [left, right],
  );
  return rows[0].value;
}

async function subtractToShares(db: Queryable, left: string, right: string): Promise<string> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT
       ROUND(($1::numeric - $2::numeric), 3)::numeric(18,3)::text AS value`,
    [left, right],
  );
  return rows[0].value;
}

async function computeBuyPosition(
  db: Queryable,
  currentShares: string,
  currentAvgCost: string,
  buyShares: string,
  buyTotalValue: string,
): Promise<BuyPositionResult> {
  const { rows } = await db.query<{ shares: string; avg_cost: string }>(
    `SELECT
       ROUND(($1::numeric + $3::numeric), 3)::numeric(18,3)::text AS shares,
       CASE
         WHEN ($1::numeric + $3::numeric) = 0 THEN '0.00'
         ELSE ROUND(
           (
             (($1::numeric * $2::numeric) + $4::numeric) /
             ($1::numeric + $3::numeric)
           ),
           2
         )::numeric(18,2)::text
       END AS avg_cost`,
    [currentShares, currentAvgCost, buyShares, buyTotalValue],
  );
  return {
    shares: rows[0].shares,
    avgCost: rows[0].avg_cost,
  };
}

async function lockPortfolioByUserId(userId: number, db: Queryable): Promise<LockedPortfolio | null> {
  const { rows } = await db.query<{ portfolio_id: number; lp_balance: string }>(
    `SELECT portfolio_id, lp_balance
     FROM portfolios
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    portfolioId: row.portfolio_id,
    lpBalance: row.lp_balance,
  };
}

export async function getPortfolioSnapshot(userId: number): Promise<PortfolioSnapshot> {
  const portfolio = await findPortfolioByUserId(userId);
  if (!portfolio) {
    throw new PortfolioServiceError(404, "Portfolio not found");
  }

  const [positions, trades] = await Promise.all([
    listPortfolioPositionsWithMarket(portfolio.portfolioId),
    listPortfolioTradesWithPlayer(portfolio.portfolioId, { limit: TRADE_HISTORY_LIMIT }),
  ]);

  return {
    portfolioId: portfolio.portfolioId,
    userId: portfolio.userId,
    lpBalance: portfolio.lpBalance,
    positions: positions.map((position) => ({
      playerId: position.playerId,
      gameName: position.gameName,
      tagLine: position.tagLine,
      platform: position.platform,
      shares: position.shares,
      avgCost: position.avgCost,
      currentPrice: position.currentPrice,
      totalCost: position.totalCost,
      marketValue: position.marketValue,
      unrealizedGain: position.unrealizedGain,
      unrealizedGainPct: position.unrealizedGainPct,
      sparklineHistory: position.sparklineHistory,
    })),
    trades: trades.map((trade) => ({
      tradeId: trade.tradeId,
      playerId: trade.playerId,
      gameName: trade.gameName,
      tagLine: trade.tagLine,
      platform: trade.platform,
      side: trade.side,
      shares: trade.shares,
      pricePerShare: trade.pricePerShare,
      totalValue: trade.totalValue,
      executedAt: trade.executedAt.toISOString(),
    })),
  };
}

export async function executePortfolioTrade(
  input: ExecutePortfolioTradeInput,
): Promise<ExecutePortfolioTradeResult> {
  const { userId, gameName, tagLine, platform, side, shares, expectedPricePerShare } = input;

  const existingPlayer = await findPlayerByRiotId(gameName, tagLine, platform);
  const latestConfirmedMatchIdBefore = existingPlayer
    ? await getLatestConfirmedMatchId(existingPlayer.playerId)
    : null;

  const score = await getPlayerScore(gameName, tagLine, platform, {
    refresh: true,
    allowStaleWhileSyncing: false,
  });
  if (score == null) {
    throw new PortfolioServiceError(400, "Player has no current price per share and cannot be traded.");
  }
  const pricePerShare = toMoneyString(score);

  const player = await findPlayerByRiotId(gameName, tagLine, platform);
  if (!player) {
    throw new PortfolioServiceError(404, "Player not found");
  }

  const latestConfirmedMatchIdAfter = await getLatestConfirmedMatchId(player.playerId);
  if (latestConfirmedMatchIdAfter !== latestConfirmedMatchIdBefore) {
    throw new PortfolioServiceError(
      409,
      SHARE_HISTORY_CHANGED_MESSAGE,
      PORTFOLIO_CONFLICT_CODES.HISTORY_CHANGED,
    );
  }

  const db = getPool();
  if ((await compareNumeric(db, expectedPricePerShare, pricePerShare)) !== 0) {
    throw new PortfolioServiceError(
      409,
      PRICE_CHANGED_MESSAGE,
      PORTFOLIO_CONFLICT_CODES.PRICE_CHANGED,
    );
  }

  const client = await getPool().connect();
  let tradeSnapshot: PortfolioTradeSnapshot;
  try {
    await client.query("BEGIN");

    const portfolio = await lockPortfolioByUserId(userId, client);
    if (!portfolio) {
      throw new PortfolioServiceError(404, "Portfolio not found");
    }

    const position = await findPortfolioPosition(portfolio.portfolioId, player.playerId, client, { forUpdate: true });
    const totalValue = await multiplyToMoney(client, shares, pricePerShare);

    if (side === "buy") {
      const hasEnoughFunds = (await compareNumeric(client, portfolio.lpBalance, totalValue)) >= 0;
      if (!hasEnoughFunds) {
        throw new PortfolioServiceError(400, "Insufficient available balance for this purchase.");
      }

      if (!position) {
        await upsertPortfolioPosition(
          portfolio.portfolioId,
          player.playerId,
          shares,
          pricePerShare,
          client,
        );
      } else {
        const next = await computeBuyPosition(
          client,
          position.shares,
          position.avgCost,
          shares,
          totalValue,
        );
        await upsertPortfolioPosition(
          portfolio.portfolioId,
          player.playerId,
          next.shares,
          next.avgCost,
          client,
        );
      }

      await client.query(
        `UPDATE portfolios
         SET lp_balance = (lp_balance - $2::numeric(18,2))::numeric(18,2),
             updated_at = NOW()
         WHERE portfolio_id = $1`,
        [portfolio.portfolioId, totalValue],
      );
    } else {
      if (!position) {
        throw new PortfolioServiceError(400, "You do not own shares of this player.");
      }

      const hasEnoughShares = (await compareNumeric(client, position.shares, shares)) >= 0;
      if (!hasEnoughShares) {
        throw new PortfolioServiceError(400, "Insufficient shares for this sell order.");
      }

      const remainingShares = await subtractToShares(client, position.shares, shares);
      const shouldDelete = (await compareNumeric(client, remainingShares, "0")) === 0;
      if (shouldDelete) {
        await deletePortfolioPosition(portfolio.portfolioId, player.playerId, client);
      } else {
        await upsertPortfolioPosition(
          portfolio.portfolioId,
          player.playerId,
          remainingShares,
          position.avgCost,
          client,
        );
      }

      await client.query(
        `UPDATE portfolios
         SET lp_balance = (lp_balance + $2::numeric(18,2))::numeric(18,2),
             updated_at = NOW()
         WHERE portfolio_id = $1`,
        [portfolio.portfolioId, totalValue],
      );
    }

    const trade = await createPortfolioTrade(
      {
        portfolioId: portfolio.portfolioId,
        playerId: player.playerId,
        side,
        shares,
        pricePerShare,
        totalValue,
      },
      client,
    );

    await client.query("COMMIT");

    tradeSnapshot = {
      tradeId: trade.tradeId,
      playerId: trade.playerId,
      gameName: player.gameName,
      tagLine: player.tagLine,
      platform: player.platform,
      side: trade.side,
      shares: trade.shares,
      pricePerShare: trade.pricePerShare,
      totalValue: trade.totalValue,
      executedAt: trade.executedAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const portfolio = await getPortfolioSnapshot(userId);
  return {
    trade: tradeSnapshot,
    portfolio,
  };
}
