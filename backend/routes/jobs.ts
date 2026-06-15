import { Router, type RequestHandler } from "express";
import { runLeaderboardSync, runRandomDiscoverySync } from "../jobs/riotHistorySync.js";
import { getRiotUsageStats } from "../lib/riot.js";
import { config } from "../lib/config.js";

const router = Router();

/**
 * Verifies the CRON_SECRET bearer token. Requests without a matching secret
 * are rejected with 401 before any job work begins.
 *
 * When CRON_SECRET is not configured the endpoint is disabled entirely so it
 * cannot be reached in environments that haven't opted in.
 */
const requireCronSecret: RequestHandler = (req, res, next) => {
  const secret = config.cronSecret();
  if (!secret) {
    res.status(503).json({ error: "Cron jobs are not configured on this server" });
    return;
  }

  const auth = req.headers.authorization ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
};

router.use(requireCronSecret);

/**
 * POST /api/jobs/riot-history-sync/leaderboard
 *
 * Refreshes match history for all players in the leaderboard rollup, syncing
 * as many as the current Riot budget allows (top N by delta_lp first).
 * Re-computes the leaderboard rollup after syncing.
 * Intended to run on a ~30-minute Railway Cron schedule.
 * Returns a compact summary suitable for Railway's log viewer.
 */
router.post("/riot-history-sync/leaderboard", async (_req, res) => {
  const result = await runLeaderboardSync();
  res.json(result);
});

/**
 * POST /api/jobs/riot-history-sync/random
 *
 * Continuously syncs random stale players until the Riot budget is exhausted
 * or no more stale players remain. Budget is re-evaluated before each player
 * using the worst-case cost (21 calls). Intended to run on a ~5-minute Railway
 * Cron schedule. Returns a compact summary suitable for Railway's log viewer.
 */
router.post("/riot-history-sync/random", async (_req, res) => {
  const result = await runRandomDiscoverySync();
  res.json(result);
});

/**
 * GET /api/jobs/riot-budget
 *
 * Returns the current Riot API outbound usage stats for the last 15 minutes.
 * Useful for debugging how much budget recent user traffic has consumed before
 * manually triggering a cron job.
 */
router.get("/riot-budget", (_req, res) => {
  res.json(getRiotUsageStats());
});

export default router;
