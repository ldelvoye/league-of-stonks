import { getPool } from "../index.js";

export interface TopPerformerRow {
  gameName: string;
  tagLine: string;
  currentScore: number;
  baselineScore: number;
  deltaLp: number;
  deltaPct: number | null;
}

export interface RecentTradeRow {
  tradeId: number;
  gameName: string;
  tagLine: string;
  side: "buy" | "sell";
  shares: string;
  pricePerShare: string;
  totalValue: string;
  executedAt: Date;
}

export interface MarketStatsRow {
  trackedSummoners: number;
  totalTrades: number;
  volume24h: string;
}

function mapTopPerformerRow(row: Record<string, unknown>): TopPerformerRow {
  return {
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    currentScore: row.current_score as number,
    baselineScore: row.baseline_score as number,
    deltaLp: row.delta_lp as number,
    deltaPct: row.delta_pct != null ? Number(row.delta_pct) : null,
  };
}

// Default window used by the leaderboard rollup.  Requests for this window
// are served from the pre-computed table; other windows fall back to live queries.
const ROLLUP_WINDOW_DAYS = 30;

export async function queryTopPerformers(
  { limit = 10, windowDays = 30 }: { limit?: number; windowDays?: number } = {},
  db = getPool(),
): Promise<TopPerformerRow[]> {
  if (windowDays === ROLLUP_WINDOW_DAYS) {
    const { rows } = await db.query(
      `SELECT game_name, tag_line, current_score, baseline_score, delta_lp, delta_pct
       FROM leaderboard_rollup
       ORDER BY delta_lp DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((row) => mapTopPerformerRow(row as Record<string, unknown>));
  }

  // Non-default window: run the live lateral scan.
  // This path is rare and is already protected by the route-level cache.
  const { rows } = await db.query(
    `SELECT
       p.game_name,
       p.tag_line,
       last_snap.score  AS current_score,
       first_snap.score AS baseline_score,
       (last_snap.score - first_snap.score) AS delta_lp,
       CASE WHEN first_snap.score > 0
            THEN ROUND((last_snap.score - first_snap.score)::numeric / first_snap.score * 100, 2)
            ELSE NULL
       END AS delta_pct
     FROM players p
     JOIN LATERAL (
       SELECT score FROM score_snapshots
       WHERE player_id = p.player_id AND score IS NOT NULL
       ORDER BY COALESCE(game_ended_at, recorded_at) DESC LIMIT 1
     ) last_snap ON true
     JOIN LATERAL (
       SELECT score FROM score_snapshots
       WHERE player_id = p.player_id AND score IS NOT NULL
         AND recorded_at >= NOW() - make_interval(days => $2::int)
       ORDER BY recorded_at ASC LIMIT 1
     ) first_snap ON true
     WHERE (last_snap.score - first_snap.score) > 0
     ORDER BY delta_lp DESC
     LIMIT $1`,
    [limit, windowDays],
  );

  return rows.map((row) => mapTopPerformerRow(row as Record<string, unknown>));
}

// Recomputes the leaderboard_rollup table for the default 30-day window.
// Called by the scheduled job in backend/index.ts every few minutes.
export async function refreshLeaderboard(db = getPool()): Promise<void> {
  await db.query(
    `WITH latest AS (
       SELECT
         p.player_id,
         p.game_name,
         p.tag_line,
         last_snap.score  AS current_score,
         first_snap.score AS baseline_score,
         (last_snap.score - first_snap.score) AS delta_lp,
         CASE WHEN first_snap.score > 0
              THEN ROUND((last_snap.score - first_snap.score)::numeric / first_snap.score * 100, 2)
              ELSE NULL
         END AS delta_pct,
         $1::int AS window_days,
         NOW() AS computed_at
       FROM players p
       JOIN LATERAL (
         SELECT score FROM score_snapshots
         WHERE player_id = p.player_id AND score IS NOT NULL
         ORDER BY COALESCE(game_ended_at, recorded_at) DESC LIMIT 1
       ) last_snap ON true
       JOIN LATERAL (
         SELECT score FROM score_snapshots
         WHERE player_id = p.player_id AND score IS NOT NULL
           AND recorded_at >= NOW() - make_interval(days => $1::int)
         ORDER BY recorded_at ASC LIMIT 1
       ) first_snap ON true
       WHERE (last_snap.score - first_snap.score) > 0
     ),
     upserted AS (
       INSERT INTO leaderboard_rollup (
         player_id, game_name, tag_line,
         current_score, baseline_score, delta_lp, delta_pct,
         window_days, computed_at
       )
       SELECT
         player_id,
         game_name,
         tag_line,
         current_score,
         baseline_score,
         delta_lp,
         delta_pct,
         window_days,
         computed_at
       FROM latest
       ON CONFLICT (player_id) DO UPDATE
         SET game_name      = EXCLUDED.game_name,
             tag_line       = EXCLUDED.tag_line,
             current_score  = EXCLUDED.current_score,
             baseline_score = EXCLUDED.baseline_score,
             delta_lp       = EXCLUDED.delta_lp,
             delta_pct      = EXCLUDED.delta_pct,
             window_days    = EXCLUDED.window_days,
             computed_at    = EXCLUDED.computed_at
       RETURNING player_id
     )
     DELETE FROM leaderboard_rollup lr
     WHERE lr.window_days = $1::int
       AND NOT EXISTS (
         SELECT 1
         FROM latest
         WHERE latest.player_id = lr.player_id
       )`,
    [ROLLUP_WINDOW_DAYS],
  );
}

// Refresh interval: 5 minutes keeps the leaderboard fresh without hammering
// the DB on every request.
const LEADERBOARD_REFRESH_INTERVAL_MS = Number(
  process.env.LEADERBOARD_REFRESH_MS ?? 5 * 60 * 1000,
);

export function scheduleLeaderboardRefresh(): NodeJS.Timeout {
  return setInterval(() => {
    refreshLeaderboard().catch((err) =>
      console.error("[leaderboard] refresh failed", err.message),
    );
  }, LEADERBOARD_REFRESH_INTERVAL_MS);
}

export async function queryRecentTrades(
  { limit = 20 }: { limit?: number } = {},
  db = getPool(),
): Promise<RecentTradeRow[]> {
  const { rows } = await db.query(
    `SELECT
       pt.trade_id,
       p.game_name,
       p.tag_line,
       pt.side,
       pt.shares,
       pt.price_per_share,
       pt.total_value,
       pt.executed_at
     FROM portfolio_trades pt
     JOIN players p ON p.player_id = pt.player_id
     ORDER BY pt.executed_at DESC, pt.trade_id DESC
     LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    tradeId: row.trade_id as number,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    side: row.side as "buy" | "sell",
    shares: row.shares as string,
    pricePerShare: row.price_per_share as string,
    totalValue: row.total_value as string,
    executedAt: row.executed_at as Date,
  }));
}

export async function queryMarketStats(db = getPool()): Promise<MarketStatsRow> {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM players)             AS tracked_summoners,
       (SELECT COUNT(*)::int FROM portfolio_trades)    AS total_trades,
       (SELECT COALESCE(SUM(total_value), 0)::text
          FROM portfolio_trades
          WHERE executed_at >= NOW() - INTERVAL '24 hours') AS volume_24h`,
  );
  const row = rows[0];
  return {
    trackedSummoners: row.tracked_summoners as number,
    totalTrades: row.total_trades as number,
    volume24h: row.volume_24h as string,
  };
}
