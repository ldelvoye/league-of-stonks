import { getPool } from "../index.js";
import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface PortfolioPosition {
  positionId: number;
  portfolioId: number;
  playerId: number;
  shares: string;
  avgCost: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioPositionWithMarket extends PortfolioPosition {
  gameName: string;
  tagLine: string;
  platform: string;
  currentPrice: string | null;
  totalCost: string;
  marketValue: string | null;
  unrealizedGain: string | null;
  unrealizedGainPct: string | null;
}

const POSITION_COLUMNS =
  "position_id, portfolio_id, player_id, shares, avg_cost, created_at, updated_at";

function mapPortfolioPosition(row: Record<string, unknown> | undefined): PortfolioPosition | null {
  if (!row) return null;
  return {
    positionId: row.position_id as number,
    portfolioId: row.portfolio_id as number,
    playerId: row.player_id as number,
    shares: row.shares as string,
    avgCost: row.avg_cost as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapPortfolioPositionWithMarket(
  row: Record<string, unknown>,
): PortfolioPositionWithMarket {
  return {
    positionId: row.position_id as number,
    portfolioId: row.portfolio_id as number,
    playerId: row.player_id as number,
    shares: row.shares as string,
    avgCost: row.avg_cost as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    platform: row.platform as string,
    currentPrice: (row.current_price as string | null) ?? null,
    totalCost: row.total_cost as string,
    marketValue: (row.market_value as string | null) ?? null,
    unrealizedGain: (row.unrealized_gain as string | null) ?? null,
    unrealizedGainPct: (row.unrealized_gain_pct as string | null) ?? null,
  };
}

export async function findPortfolioPosition(
  portfolioId: number,
  playerId: number,
  db: Queryable = getPool(),
): Promise<PortfolioPosition | null> {
  const { rows } = await db.query(
    `SELECT ${POSITION_COLUMNS}
     FROM portfolio_positions
     WHERE portfolio_id = $1 AND player_id = $2`,
    [portfolioId, playerId],
  );
  return mapPortfolioPosition(rows[0]);
}

export async function upsertPortfolioPosition(
  portfolioId: number,
  playerId: number,
  shares: string,
  avgCost: string,
  db: Queryable = getPool(),
): Promise<PortfolioPosition> {
  const { rows } = await db.query(
    `INSERT INTO portfolio_positions (portfolio_id, player_id, shares, avg_cost)
     VALUES ($1, $2, $3::numeric(18,3), $4::numeric(18,2))
     ON CONFLICT (portfolio_id, player_id)
     DO UPDATE
       SET shares = EXCLUDED.shares,
           avg_cost = EXCLUDED.avg_cost,
           updated_at = NOW()
     RETURNING ${POSITION_COLUMNS}`,
    [portfolioId, playerId, shares, avgCost],
  );
  return mapPortfolioPosition(rows[0]) as PortfolioPosition;
}

export async function deletePortfolioPosition(
  portfolioId: number,
  playerId: number,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `DELETE FROM portfolio_positions
     WHERE portfolio_id = $1 AND player_id = $2`,
    [portfolioId, playerId],
  );
}

export async function listPortfolioPositionsWithMarket(
  portfolioId: number,
  db: Queryable = getPool(),
): Promise<PortfolioPositionWithMarket[]> {
  const { rows } = await db.query(
    `SELECT
       portfolio_positions.position_id,
       portfolio_positions.portfolio_id,
       portfolio_positions.player_id,
       portfolio_positions.shares,
       portfolio_positions.avg_cost,
       portfolio_positions.created_at,
       portfolio_positions.updated_at,
       players.game_name,
       players.tag_line,
       players.platform,
       latest.current_price,
       ROUND((portfolio_positions.shares * portfolio_positions.avg_cost), 2)::numeric(18,2) AS total_cost,
       CASE
         WHEN latest.current_price IS NULL THEN NULL
         ELSE ROUND((portfolio_positions.shares * latest.current_price), 2)::numeric(18,2)
       END AS market_value,
       CASE
         WHEN latest.current_price IS NULL THEN NULL
         ELSE ROUND(
           (portfolio_positions.shares * latest.current_price) -
           (portfolio_positions.shares * portfolio_positions.avg_cost),
           2
         )::numeric(18,2)
       END AS unrealized_gain,
       CASE
         WHEN latest.current_price IS NULL OR (portfolio_positions.shares * portfolio_positions.avg_cost) = 0
           THEN NULL
         ELSE ROUND(
           (
             (
               (portfolio_positions.shares * latest.current_price) -
               (portfolio_positions.shares * portfolio_positions.avg_cost)
             ) / (portfolio_positions.shares * portfolio_positions.avg_cost)
           ) * 100,
           4
         )::numeric(18,4)
       END AS unrealized_gain_pct
     FROM portfolio_positions
     JOIN players ON players.player_id = portfolio_positions.player_id
     LEFT JOIN LATERAL (
       SELECT
         CASE
           WHEN score_snapshots.score IS NULL THEN NULL
           ELSE score_snapshots.score::numeric(18,2)
         END AS current_price
       FROM score_snapshots
       WHERE score_snapshots.player_id = portfolio_positions.player_id
       ORDER BY COALESCE(score_snapshots.game_ended_at, score_snapshots.recorded_at) DESC
       LIMIT 1
     ) latest ON true
     WHERE portfolio_positions.portfolio_id = $1
     ORDER BY portfolio_positions.updated_at DESC`,
    [portfolioId],
  );
  return rows.map((row) => mapPortfolioPositionWithMarket(row as Record<string, unknown>));
}
