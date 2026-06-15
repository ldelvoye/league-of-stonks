import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import type { PortfolioTradeSide } from "../db/tables/portfolioTrades.js";
import { requireAuth } from "../lib/auth.js";
import { requireSafeOrigin } from "../lib/csrf.js";
import {
  executePortfolioTrade,
  getPortfolioSnapshot,
  normalizePricePerShareInput,
  normalizeSharesInput,
} from "../lib/portfolioService.js";
import { getPlatform } from "../lib/riot.js";

const router = Router();

// Portfolio reads: 120 per 15 minutes per user (well above any reasonable UX usage).
// keyGenerator uses userId only — req.ip is intentionally omitted because these
// routes are authenticated and req.user is always set when the limiter runs.
const portfolioReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  keyGenerator: (req) => String(req.user?.userId ?? "unauthenticated"),
});

// Trade submissions: 30 per 15 minutes per user.
const portfolioTradeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many trade requests, please try again later" },
  keyGenerator: (req) => String(req.user?.userId ?? "unauthenticated"),
});

function parseTradeSide(value: unknown): PortfolioTradeSide | null {
  if (value === "buy" || value === "sell") return value;
  return null;
}

function normalizeRiotSegment(value: unknown, maxLength = 64): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.emailVerified) {
    res.status(403).json({ error: "Verify your email to access your portfolio." });
    return;
  }
  next();
}

router.get("/", requireAuth, requireVerifiedEmail, portfolioReadLimiter, async (req, res) => {
  const portfolio = await getPortfolioSnapshot(req.user!.userId);
  res.json(portfolio);
});

router.post("/trades", requireSafeOrigin, requireAuth, requireVerifiedEmail, portfolioTradeLimiter, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const gameName = normalizeRiotSegment(body.gameName, 64);
  const tagLine = normalizeRiotSegment(body.tagLine, 16);
  const side = parseTradeSide(body.side);
  const shares = normalizeSharesInput(body.shares);
  const expectedPricePerShare = normalizePricePerShareInput(body.expectedPricePerShare);

  if (!gameName || !tagLine || !side || !shares || !expectedPricePerShare) {
    res.status(400).json({
      error:
        "gameName, tagLine, side (buy/sell), expectedPricePerShare, and a positive shares value are required.",
    });
    return;
  }

  const result = await executePortfolioTrade({
    userId: req.user!.userId,
    gameName,
    tagLine,
    platform: getPlatform(req),
    side,
    shares,
    expectedPricePerShare,
  });
  res.status(201).json(result);
});

export default router;
