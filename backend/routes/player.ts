import { Router } from "express";
import { getPlayerHistory, getPlayerScore } from "../lib/playerService.js";
import { getPlatform, RiotApiError } from "../lib/riot.js";

const router = Router();

function toClientStatus(riotStatus: number): number {
  if (riotStatus === 404) return 404;
  if (riotStatus === 429) return 429;
  return 502;
}

// Get player history
router.get("/:gameName/:tagLine/history", async (req, res) => {
  const { gameName, tagLine } = req.params;
  const platform = getPlatform(req);
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);

  const result = await getPlayerHistory(gameName, tagLine, platform, { limit });
  if (!result) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json(result);
});

// Get player score and update the player's score in the database
router.get("/:gameName/:tagLine", async (req, res) => {
  const { gameName, tagLine } = req.params;
  const platform = getPlatform(req);

  try {
    const score = await getPlayerScore(gameName, tagLine, platform);
    res.json({ score });
  } catch (error) {
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
