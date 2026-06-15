import { queryTopPerformers, refreshLeaderboard } from "../db/tables/market.js";
import { queryRandomStalePlayers } from "../db/tables/players.js";
import { syncPlayerForCron } from "../lib/playerService.js";
import { getRiotUsageStats, type RiotUsageStats } from "../lib/riot.js";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";

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

function toErrorContext(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

/**
 * Syncs top performers from the leaderboard rollup.
 *
 * These players are expected to be inexpensive — most will have only 1-2 new
 * games since the last run, so the Riot call pattern is typically:
 *   match-list (1) + match details (0-2) + league (0-1) = 1-4 calls/player.
 *
 * Runs `refreshLeaderboard()` after syncing so the market view is up to date.
 */
export async function runLeaderboardSync({
  topLimit = 3,
}: { topLimit?: number } = {}): Promise<SyncJobResult> {
  const startMs = Date.now();
  const statsBefore = getRiotUsageStats();

  const budgetConstrained =
    statsBefore.last2mTotal >= config.cronRiotBudgetThreshold();

  if (budgetConstrained) {
    logger.warn("cron leaderboard sync skipped: riot budget threshold reached", {
      last2mTotal: statsBefore.last2mTotal,
      threshold: config.cronRiotBudgetThreshold(),
    });
    return {
      mode: "leaderboard",
      selected: 0,
      skipped: 0,
      synced: 0,
      failed: 0,
      durationMs: Date.now() - startMs,
      budgetConstrained: true,
      riotStats: statsBefore,
    };
  }

  const performers = await queryTopPerformers({ limit: topLimit });

  let synced = 0;
  let failed = 0;

  for (const performer of performers) {
    try {
      await syncPlayerForCron(performer.gameName, performer.tagLine, "na1");
      synced += 1;
    } catch (err) {
      failed += 1;
      logger.error("cron leaderboard sync: player sync failed", {
        gameName: performer.gameName,
        tagLine: performer.tagLine,
        err: toErrorContext(err),
      });
    }
  }

  if (synced > 0) {
    try {
      await refreshLeaderboard();
    } catch (err) {
      logger.error("cron leaderboard sync: leaderboard refresh failed", {
        err: toErrorContext(err),
      });
    }
  }

  const result: SyncJobResult = {
    mode: "leaderboard",
    selected: performers.length,
    skipped: 0,
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
 * Syncs as many random stale players as the current Riot API budget allows,
 * up to `maxLimit` as a hard safety cap.
 *
 * These syncs are expensive because lobby snapshots can introduce up to 9 new
 * players per match, each of which may receive a league call on their next
 * refresh. The target count is computed dynamically from the remaining 2-minute
 * budget so the job automatically backs off when user traffic is elevated and
 * runs aggressively when the API is quiet.
 */
export async function runRandomDiscoverySync({
  maxLimit = 10,
}: { maxLimit?: number } = {}): Promise<SyncJobResult> {
  const startMs = Date.now();
  const statsBefore = getRiotUsageStats();

  const budgetThreshold = config.cronRiotBudgetThreshold();
  const budgetConstrained = statsBefore.last2mTotal >= budgetThreshold;

  if (budgetConstrained) {
    logger.warn("cron random discovery skipped: riot budget threshold reached", {
      last2mTotal: statsBefore.last2mTotal,
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
      riotStats: statsBefore,
    };
  }

  // Derive how many players we can safely sync from the remaining budget.
  // Each full discovery sync costs roughly 21 calls in the worst case
  // (1 match-list + 10 match details + 1 league + 9 lobby league calls),
  // but averages ~3-5 calls for players who are mostly up to date.
  // We use 5 as a conservative estimate to stay well within the window.
  const ESTIMATED_CALLS_PER_PLAYER = 5;
  const remaining = budgetThreshold - statsBefore.last2mTotal;
  const budgetDrivenLimit = Math.floor(remaining / ESTIMATED_CALLS_PER_PLAYER);
  const safeLimit = Math.min(maxLimit, budgetDrivenLimit);

  if (safeLimit <= 0) {
    return {
      mode: "random-discovery",
      selected: 0,
      skipped: budgetDrivenLimit < 1 ? 1 : 0,
      synced: 0,
      failed: 0,
      durationMs: Date.now() - startMs,
      budgetConstrained: false,
      riotStats: statsBefore,
    };
  }

  // queryTopPerformers doesn't return DB player IDs, so we can't exclude them
  // by ID here. The 5-minute cooldown makes any overlap a cheap no-op: a player
  // recently synced by the leaderboard job will be skipped inside playerService
  // without touching Riot. The two pools are logically separated by staleness.
  const candidates = await queryRandomStalePlayers(safeLimit);

  let synced = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      await syncPlayerForCron(candidate.gameName, candidate.tagLine, candidate.platform);
      synced += 1;
    } catch (err) {
      failed += 1;
      logger.error("cron random discovery: player sync failed", {
        gameName: candidate.gameName,
        tagLine: candidate.tagLine,
        err: toErrorContext(err),
      });
    }
  }

  if (synced > 0) {
    try {
      await refreshLeaderboard();
    } catch (err) {
      logger.error("cron random discovery: leaderboard refresh failed", {
        err: toErrorContext(err),
      });
    }
  }

  const result: SyncJobResult = {
    mode: "random-discovery",
    selected: candidates.length,
    skipped: Math.max(0, maxLimit - safeLimit),
    synced,
    failed,
    durationMs: Date.now() - startMs,
    budgetConstrained: false,
    riotStats: getRiotUsageStats(),
  };

  logger.info("cron random discovery complete", { ...result });
  return result;
}
