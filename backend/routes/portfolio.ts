import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PortfolioTradeSide } from "../db/tables/portfolioTrades.js";
import { requireAuth } from "../lib/auth.js";
import {
  executePortfolioTrade,
  getPortfolioSnapshot,
  normalizeSharesInput,
  PortfolioServiceError,
} from "../lib/portfolioService.js";
import { getPlatform, RiotApiError } from "../lib/riot.js";

const router = Router();

function toClientStatus(riotStatus: number): number {
  if (riotStatus === 404) return 404;
  if (riotStatus === 429) return 429;
  return 502;
}

function parseTradeSide(value: unknown): PortfolioTradeSide | null {
  if (value === "buy" || value === "sell") return value;
  return null;
}

function normalizeRiotSegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return null;
  return trimmed;
}

function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.emailVerified) {
    res.status(403).json({ error: "Verify your email to access your portfolio." });
    return;
  }
  next();
}

router.get("/", requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const portfolio = await getPortfolioSnapshot(req.user!.userId);
    res.json(portfolio);
  } catch (error) {
    if (error instanceof PortfolioServiceError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/trades", requireAuth, requireVerifiedEmail, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const gameName = normalizeRiotSegment(body.gameName);
  const tagLine = normalizeRiotSegment(body.tagLine);
  const side = parseTradeSide(body.side);
  const shares = normalizeSharesInput(body.shares);

  if (!gameName || !tagLine || !side || !shares) {
    res.status(400).json({
      error: "gameName, tagLine, side (buy/sell), and a positive shares value are required.",
    });
    return;
  }

  try {
    const result = await executePortfolioTrade({
      userId: req.user!.userId,
      gameName,
      tagLine,
      platform: getPlatform(req),
      side,
      shares,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof PortfolioServiceError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof RiotApiError) {
      console.error(`${error.step} lookup failed (${error.status})`, error.data);
      res.status(toClientStatus(error.status)).json({ error: `${error.step} lookup failed` });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
