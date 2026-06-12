import { Router } from "express";
import { getPool } from "../db/index.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

export default router;
