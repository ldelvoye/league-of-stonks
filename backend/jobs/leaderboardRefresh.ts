import { refreshLeaderboard } from "../db/tables/market.js";
import { config } from "../lib/config.js";
import { logger, toErrorObj } from "../lib/logger.js";

export function scheduleLeaderboardRefresh(): NodeJS.Timeout {
  const refreshMs = config.leaderboardRefreshMs();
  return setInterval(() => {
    refreshLeaderboard().catch((err) => {
      logger.error("Scheduled leaderboard refresh failed", {
        event: "jobs.leaderboard_refresh.failed",
        category: "jobs",
        action: "leaderboard_refresh",
        outcome: "failure",
        error: toErrorObj(err),
      });
    });
  }, refreshMs);
}
