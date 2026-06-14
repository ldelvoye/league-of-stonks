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

export interface SparklinePoint {
  score: number | null;
  recordedAt: string;
  matchId: string | null;
  source: "snapshot" | "confirmed" | "estimated";
  won: boolean | null;
  championName: string | null;
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
  sparklineHistory: SparklinePoint[];
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
    sparklineHistory: (row.sparkline_history as SparklinePoint[] | null) ?? [],
  };
}

export async function findPortfolioPosition(
  portfolioId: number,
  playerId: number,
  db: Queryable = getPool(),
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<PortfolioPosition | null> {
  const { rows } = await db.query(
    `SELECT ${POSITION_COLUMNS}
     FROM portfolio_positions
     WHERE portfolio_id = $1 AND player_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
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
       CASE
         WHEN pls.score IS NULL THEN NULL
         ELSE pls.score::numeric(18,2)
       END AS current_price,
       ROUND((portfolio_positions.shares * portfolio_positions.avg_cost), 2)::numeric(18,2) AS total_cost,
       CASE
         WHEN pls.score IS NULL THEN NULL
         ELSE ROUND((portfolio_positions.shares * pls.score::numeric(18,2)), 2)::numeric(18,2)
       END AS market_value,
       CASE
         WHEN pls.score IS NULL THEN NULL
         ELSE ROUND(
           (portfolio_positions.shares * pls.score::numeric(18,2)) -
           (portfolio_positions.shares * portfolio_positions.avg_cost),
           2
         )::numeric(18,2)
       END AS unrealized_gain,
       CASE
         WHEN pls.score IS NULL OR (portfolio_positions.shares * portfolio_positions.avg_cost) = 0
           THEN NULL
         ELSE ROUND(
           (
             (
               (portfolio_positions.shares * pls.score::numeric(18,2)) -
               (portfolio_positions.shares * portfolio_positions.avg_cost)
             ) / (portfolio_positions.shares * portfolio_positions.avg_cost)
           ) * 100,
           4
         )::numeric(18,4)
       END AS unrealized_gain_pct,
       COALESCE(hist.sparkline_history, '[]'::json) AS sparkline_history
     FROM portfolio_positions
     JOIN players ON players.player_id = portfolio_positions.player_id
     LEFT JOIN player_latest_scores pls ON pls.player_id = portfolio_positions.player_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         json_agg(
           json_build_object(
             'score', snap.score,
             'recordedAt', to_char(snap.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'matchId', snap.match_id,
             'source', snap.source,
             'won', snap.won,
             'championName', snap.champion_name
           )
           ORDER BY snap.effective_at ASC
         ),
         '[]'::json
       ) AS sparkline_history
       FROM (
         SELECT
           score,
           match_id,
           source,
           won,
           champion_name,
           COALESCE(game_ended_at, recorded_at) AS effective_at
         FROM score_snapshots
         WHERE player_id = portfolio_positions.player_id
         ORDER BY COALESCE(game_ended_at, recorded_at) DESC
         LIMIT 30
       ) snap
     ) hist ON true
     WHERE portfolio_positions.portfolio_id = $1
     ORDER BY portfolio_positions.updated_at DESC`,
    [portfolioId],
  );
  return rows.map((row) => mapPortfolioPositionWithMarket(row as Record<string, unknown>));
}
