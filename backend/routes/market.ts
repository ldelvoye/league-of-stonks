import { Router } from "express";
import { queryMarketStats, queryRecentTrades, queryTopPerformers } from "../db/tables/market.js";

const router = Router();

router.get("/stats", async (_req, res) => {
  try {
    const stats = await queryMarketStats();
    res.json(stats);
  } catch (error) {
    console.error("market/stats error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/top", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);
    const windowDays = Math.min(parseInt(req.query.window as string, 10) || 30, 90);
    const performers = await queryTopPerformers({ limit, windowDays });
    res.json(performers);
  } catch (error) {
    console.error("market/top error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recent-trades", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const trades = await queryRecentTrades({ limit });
    res.json(trades);
  } catch (error) {
    console.error("market/recent-trades error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
