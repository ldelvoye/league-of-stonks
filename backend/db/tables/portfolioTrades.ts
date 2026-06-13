import { getPool } from "../index.js";
import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export type PortfolioTradeSide = "buy" | "sell";

export interface PortfolioTrade {
  tradeId: number;
  portfolioId: number;
  playerId: number;
  side: PortfolioTradeSide;
  shares: string;
  pricePerShare: string;
  totalValue: string;
  executedAt: Date;
}

export interface PortfolioTradeWithPlayer extends PortfolioTrade {
  gameName: string;
  tagLine: string;
  platform: string;
}

interface CreatePortfolioTradeInput {
  portfolioId: number;
  playerId: number;
  side: PortfolioTradeSide;
  shares: string;
  pricePerShare: string;
  totalValue: string;
}

const TRADE_COLUMNS =
  "trade_id, portfolio_id, player_id, side, shares, price_per_share, total_value, executed_at";

function mapPortfolioTrade(row: Record<string, unknown> | undefined): PortfolioTrade | null {
  if (!row) return null;
  return {
    tradeId: row.trade_id as number,
    portfolioId: row.portfolio_id as number,
    playerId: row.player_id as number,
    side: row.side as PortfolioTradeSide,
    shares: row.shares as string,
    pricePerShare: row.price_per_share as string,
    totalValue: row.total_value as string,
    executedAt: row.executed_at as Date,
  };
}

function mapPortfolioTradeWithPlayer(row: Record<string, unknown>): PortfolioTradeWithPlayer {
  return {
    tradeId: row.trade_id as number,
    portfolioId: row.portfolio_id as number,
    playerId: row.player_id as number,
    side: row.side as PortfolioTradeSide,
    shares: row.shares as string,
    pricePerShare: row.price_per_share as string,
    totalValue: row.total_value as string,
    executedAt: row.executed_at as Date,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    platform: row.platform as string,
  };
}

export async function createPortfolioTrade(
  input: CreatePortfolioTradeInput,
  db: Queryable = getPool(),
): Promise<PortfolioTrade> {
  const { portfolioId, playerId, side, shares, pricePerShare, totalValue } = input;
  const { rows } = await db.query(
    `INSERT INTO portfolio_trades (
       portfolio_id,
       player_id,
       side,
       shares,
       price_per_share,
       total_value
     ) VALUES ($1, $2, $3, $4::numeric(18,3), $5::numeric(18,2), $6::numeric(18,2))
     RETURNING ${TRADE_COLUMNS}`,
    [portfolioId, playerId, side, shares, pricePerShare, totalValue],
  );
  return mapPortfolioTrade(rows[0]) as PortfolioTrade;
}

export async function listPortfolioTradesWithPlayer(
  portfolioId: number,
  { limit = 40 }: { limit?: number } = {},
  db: Queryable = getPool(),
): Promise<PortfolioTradeWithPlayer[]> {
  const { rows } = await db.query(
    `SELECT
       portfolio_trades.trade_id,
       portfolio_trades.portfolio_id,
       portfolio_trades.player_id,
       portfolio_trades.side,
       portfolio_trades.shares,
       portfolio_trades.price_per_share,
       portfolio_trades.total_value,
       portfolio_trades.executed_at,
       players.game_name,
       players.tag_line,
       players.platform
     FROM portfolio_trades
     JOIN players ON players.player_id = portfolio_trades.player_id
     WHERE portfolio_trades.portfolio_id = $1
     ORDER BY portfolio_trades.executed_at DESC, portfolio_trades.trade_id DESC
     LIMIT $2`,
    [portfolioId, limit],
  );
  return rows.map((row) => mapPortfolioTradeWithPlayer(row as Record<string, unknown>));
}
