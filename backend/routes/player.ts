import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { getPlayerHistory, getPlayerScore, getPlayerScoreAndHistory } from "../lib/playerService.js";
import { getPlatform } from "../lib/riot.js";
import { parseBoundedPositiveIntQuery } from "../lib/validation.js";

const router = Router();

// General read limit: 200 requests per 15 minutes per IP.
const playerReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Strict limit for ?refresh=1 which triggers Riot API calls.
const playerRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many refresh requests, please try again later" },
});

// Only applies the refresh limiter when the request actually asks for a sync.
const conditionalRefreshLimiter: RequestHandler = (req, res, next) => {
  const isRefresh = req.query.refresh === "1" || req.query.refresh === "true";
  if (isRefresh) {
    playerRefreshLimiter(req, res, next);
    return;
  }
  next();
};

// Returns typed {gameName, tagLine} strings, or null if validation fails.
// Accepts string | string[] to match Express 5 param types.
function parseRiotIdParams(
  rawGameName: string | string[],
  rawTagLine: string | string[],
): { gameName: string; tagLine: string } | null {
  if (typeof rawGameName !== "string" || !rawGameName || rawGameName.length > 64) return null;
  if (typeof rawTagLine !== "string" || !rawTagLine || rawTagLine.length > 16) return null;
  return { gameName: rawGameName, tagLine: rawTagLine };
}

// Get player history
router.get("/:gameName/:tagLine/history", playerReadLimiter, async (req, res) => {
  const parsed = parseRiotIdParams(req.params.gameName, req.params.tagLine);
  if (!parsed) {
    res.status(400).json({ error: "Invalid player name or tag" });
    return;
  }
  const { gameName, tagLine } = parsed;

  const platform = getPlatform(req);
  const limit = parseBoundedPositiveIntQuery(req.query.limit, 100, 500);
  if (limit == null) {
    res.status(400).json({ error: "limit must be a positive integer within allowed range." });
    return;
  }

  const result = await getPlayerHistory(gameName, tagLine, platform, { limit });
  if (!result) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(result);
});

// Get player score; optional sync/backfill runs when refresh=1
router.get("/:gameName/:tagLine", playerReadLimiter, conditionalRefreshLimiter, async (req, res) => {
  const parsed = parseRiotIdParams(req.params.gameName, req.params.tagLine);
  if (!parsed) {
    res.status(400).json({ error: "Invalid player name or tag" });
    return;
  }
  const { gameName, tagLine } = parsed;

  const platform = getPlatform(req);
  const includeHistory = req.query.includeHistory === "1" || req.query.includeHistory === "true";
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  const limit = parseBoundedPositiveIntQuery(req.query.limit, 100, 500);
  if (limit == null) {
    res.status(400).json({ error: "limit must be a positive integer within allowed range." });
    return;
  }

  if (includeHistory) {
    const result = await getPlayerScoreAndHistory(gameName, tagLine, platform, { limit, refresh });
    res.json(result);
    return;
  }

  const score = await getPlayerScore(gameName, tagLine, platform, { refresh });
  res.json({ score });
});

export default router;
