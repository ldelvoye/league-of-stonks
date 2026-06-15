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

// Trade burst protection: max 5 submissions per 30 seconds per user.
// Trades run the same sync path as player refresh, which may fan out into
// multiple Riot calls (match-list + match fetches + league snapshot).
const portfolioTradeBurstLimiter = rateLimit({
  windowMs: 30 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many trade requests, please slow down." },
  keyGenerator: (req) => String(req.user?.userId ?? "unauthenticated"),
});

// Trade sustained limiter: 20 per 15 minutes per user.
const portfolioTradeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many trade requests, please try again later" },
  keyGenerator: (req) => String(req.user?.userId ?? "unauthenticated"),
});

export function resetPortfolioRateLimitsForTests(): void {
  const keyCandidates = ["unauthenticated", ...Array.from({ length: 50 }, (_, index) => String(index + 1))];
  const resetters = [portfolioReadLimiter, portfolioTradeBurstLimiter, portfolioTradeLimiter];

  for (const limiter of resetters) {
    for (const key of keyCandidates) {
      limiter.resetKey(key);
    }
  }
}

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

// Every trade is tied to the authenticated user via portfolios.user_id
// (portfolio_trades.portfolio_id → portfolios.user_id). Both limiters key
// on userId so a single user cannot bypass them with concurrent requests.
router.post("/trades", requireSafeOrigin, requireAuth, requireVerifiedEmail, portfolioTradeBurstLimiter, portfolioTradeLimiter, async (req, res) => {
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
