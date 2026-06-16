import { queryTopPerformers, refreshLeaderboard } from "../db/tables/market.js";
import { queryRandomStalePlayers } from "../db/tables/players.js";
import { syncPlayerForCron } from "../lib/playerService.js";
import { getRiotUsageStats, type RiotUsageStats } from "../lib/riot.js";
import { config } from "../lib/config.js";
import { logger, toErrorObj } from "../lib/logger.js";

export type SyncMode = "leaderboard" | "random-discovery";

export interface SyncJobResult {
  mode: SyncMode;
  selected: number;
  skipped: number;
  synced: number;
  failed: number;
  durationMs: number;
  budgetConstrained: boolean;
  riotStats: RiotUsageStats;
}

// ── Per-player Riot API cost estimates ────────────────────────────────────────
// Leaderboard: assume at most 2 new games since the last 30-minute refresh.
//   1 match-list + 2 match details + 1 league anchor + 9 lobby league = 13
const LEADERBOARD_COST_PER_PLAYER = 13;
const LEADERBOARD_SYNC_LIMIT = 10;

// Random discovery: worst case — player has 10 pending matches (MATCH_SYNC_DEPTH).
//   1 match-list + 10 match details + 1 league anchor + 9 lobby league = 21
const DISCOVERY_COST_PER_PLAYER = 21;

function hasBudgetFor(costPerPlayer: number): boolean {
  const stats = getRiotUsageStats();
  const remaining = config.cronRiotBudgetThreshold() - stats.last2mTotal;
  return remaining >= costPerPlayer;
}

/**
 * Syncs the top 10 rows from leaderboard_rollup, budget permitting.
 *
 * Fetches the top N leaderboard rows ordered by delta_lp DESC, then iterates
 * top-to-bottom. Before each player the live Riot budget is re-checked;
 * iteration stops as soon as there is not enough headroom for one more player
 * sync.
 *
 * Runs `refreshLeaderboard()` after syncing so the market view is up to date.
 */
export async function runLeaderboardSync(): Promise<SyncJobResult> {
  const startMs = Date.now();
  const budgetThreshold = config.cronRiotBudgetThreshold();
  const initialStats = getRiotUsageStats();

  if (initialStats.last2mTotal >= budgetThreshold) {
    logger.warn("cron leaderboard sync skipped: riot budget threshold reached", {
      last2mTotal: initialStats.last2mTotal,
      threshold: budgetThreshold,
    });
    return {
      mode: "leaderboard",
      selected: 0,
      skipped: 0,
      synced: 0,
      failed: 0,
      durationMs: Date.now() - startMs,
      budgetConstrained: true,
      riotStats: initialStats,
    };
  }

  // Fetch only the top leaderboard rows shown on the home widget.
  const allPerformers = await queryTopPerformers({ limit: LEADERBOARD_SYNC_LIMIT });

  let synced = 0;
  let failed = 0;
  let i = 0;

  for (; i < allPerformers.length; i++) {
    if (!hasBudgetFor(LEADERBOARD_COST_PER_PLAYER)) break;

    const performer = allPerformers[i];
    try {
      await syncPlayerForCron(performer.gameName, performer.tagLine, "na1");
      synced += 1;
    } catch (err) {
      failed += 1;
      logger.error("cron leaderboard sync: player sync failed", {
        gameName: performer.gameName,
        tagLine: performer.tagLine,
        error: toErrorObj(err),
      });
    }
  }

  const skipped = allPerformers.length - i;

  if (synced > 0) {
    try {
      await refreshLeaderboard();
    } catch (err) {
      logger.error("cron leaderboard sync: leaderboard refresh failed", {
        error: toErrorObj(err),
      });
    }
  }

  const result: SyncJobResult = {
    mode: "leaderboard",
    selected: i,
    skipped,
    synced,
    failed,
    durationMs: Date.now() - startMs,
    budgetConstrained: false,
    riotStats: getRiotUsageStats(),
  };

  logger.info("cron leaderboard sync complete", { ...result });
  return result;
}

/**
 * Continuously syncs random stale players until the Riot API budget is
 * exhausted or no more stale players remain.
 *
 * Budget is re-evaluated before each player using the worst-case cost
 * (1 match-list + 10 match details + 1 league + 9 lobby = 21 calls). Players
 * that fail to sync are excluded from subsequent picks within the same run so
 * a persistently failing player cannot trap the loop.
 *
 * Discovery syncs are intentionally expensive: each player can fan out up to
 * 9 lobby snapshots, seeding the database with new players for future runs.
 */
export async function runRandomDiscoverySync(): Promise<SyncJobResult> {
  const startMs = Date.now();
  const budgetThreshold = config.cronRiotBudgetThreshold();
  const initialStats = getRiotUsageStats();

  if (initialStats.last2mTotal >= budgetThreshold) {
    logger.warn("cron random discovery skipped: riot budget threshold reached", {
      last2mTotal: initialStats.last2mTotal,
      threshold: budgetThreshold,
    });
    return {
      mode: "random-discovery",
      selected: 0,
      skipped: 0,
      synced: 0,
      failed: 0,
      durationMs: Date.now() - startMs,
      budgetConstrained: true,
      riotStats: initialStats,
    };
  }

  let synced = 0;
  let failed = 0;
  const failedIds: number[] = [];

  while (hasBudgetFor(DISCOVERY_COST_PER_PLAYER)) {
    const [candidate] = await queryRandomStalePlayers(1, failedIds);
    if (!candidate) break;

    try {
      await syncPlayerForCron(candidate.gameName, candidate.tagLine, candidate.platform);
      synced += 1;
    } catch (err) {
      failed += 1;
      failedIds.push(candidate.playerId);
      logger.error("cron random discovery: player sync failed", {
        gameName: candidate.gameName,
        tagLine: candidate.tagLine,
        error: toErrorObj(err),
      });
    }
  }

  if (synced > 0) {
    try {
      await refreshLeaderboard();
    } catch (err) {
      logger.error("cron random discovery: leaderboard refresh failed", {
        error: toErrorObj(err),
      });
    }
  }

  const result: SyncJobResult = {
    mode: "random-discovery",
    selected: synced + failed,
    skipped: 0,
    synced,
    failed,
    durationMs: Date.now() - startMs,
    budgetConstrained: false,
    riotStats: getRiotUsageStats(),
  };

  logger.info("cron random discovery complete", { ...result });
  return result;
}
