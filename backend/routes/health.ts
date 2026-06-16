import { Router } from "express";
import { getPool } from "../db/index.js";
import { logger, toErrorObj } from "../lib/logger.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    logger.error("Health check failed", {
      event: "health.check.failed",
      category: "health",
      action: "check",
      outcome: "failure",
      error: toErrorObj(err),
    });
    res.status(503).json({ ok: false });
  }
});

export default router;
