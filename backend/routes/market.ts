import { Router } from "express";
import rateLimit from "express-rate-limit";
import { queryMarketStats, queryRecentTrades, queryTopPerformers } from "../db/tables/market.js";
import { MemoryCache } from "../lib/cache.js";
import { config } from "../lib/config.js";
import { parseBoundedPositiveIntQuery } from "../lib/validation.js";

const router = Router();

// Exported so tests can inspect and clear cache state between test runs.
export const marketCache = new MemoryCache();

// Market data is public and polled by every browser tab on the home page.
// 300 per 15 minutes per IP allows ~20/min which comfortably covers multiple
// concurrent tabs while still blocking abusive crawlers.
const marketLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

router.use(marketLimiter);

router.get("/stats", async (_req, res) => {
  const stats = await marketCache.getOrSet(
    "market:stats",
    config.marketStatsTtlMs(),
    queryMarketStats,
  );
  res.json(stats);
});

router.get("/top", async (req, res) => {
  const limit = parseBoundedPositiveIntQuery(req.query.limit, 10, 50);
  const windowDays = parseBoundedPositiveIntQuery(req.query.window, 30, 90);
  if (limit == null || windowDays == null) {
    res.status(400).json({ error: "limit and window must be positive integers within allowed range." });
    return;
  }
  const key = `market:top:${limit}:${windowDays}`;
  const performers = await marketCache.getOrSet(key, config.marketTopTtlMs(), () =>
    queryTopPerformers({ limit, windowDays }),
  );
  res.json(performers);
});

router.get("/recent-trades", async (req, res) => {
  const limit = parseBoundedPositiveIntQuery(req.query.limit, 20, 100);
  if (limit == null) {
    res.status(400).json({ error: "limit must be a positive integer within allowed range." });
    return;
  }
  const key = `market:recent-trades:${limit}`;
  const trades = await marketCache.getOrSet(key, config.marketRecentTradesTtlMs(), () =>
    queryRecentTrades({ limit }),
  );
  res.json(trades);
});

export default router;
