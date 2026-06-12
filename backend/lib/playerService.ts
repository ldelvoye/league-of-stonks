import type { Player } from "../db/players.js";
import { findPlayerByRiotId, touchPlayer, upsertPlayer } from "../db/players.js";
import { getScoreHistory, recordScoreSnapshot } from "../db/scores.js";
import { canRefreshPlayer } from "./cooldown.js";
import { getAccountByRiotId, getLeagueEntriesByPuuid } from "./riot.js";
import { toSoloRanked } from "./rank.js";

async function resolvePlayer(
  gameName: string,
  tagLine: string,
  platform: string,
): Promise<Player> {
  const cached = await findPlayerByRiotId(gameName, tagLine, platform);
  if (cached) {
    return cached;
  }

  const account = await getAccountByRiotId(gameName, tagLine);

  return upsertPlayer({
    gameName: account.gameName,
    tagLine: account.tagLine,
    puuid: account.puuid,
    platform,
  });
}

export interface PlayerHistory {
  gameName: string;
  tagLine: string;
  history: Array<{ score: number | null; recordedAt: Date }>;
}

export async function getPlayerHistory(
  gameName: string,
  tagLine: string,
  platform: string,
  { limit = 100 }: { limit?: number } = {},
): Promise<PlayerHistory | null> {
  const player = await findPlayerByRiotId(gameName, tagLine, platform);
  if (!player) {
    return null;
  }

  const history = await getScoreHistory(player.id, { limit });
  return {
    gameName: player.gameName,
    tagLine: player.tagLine,
    history: history.reverse().map(({ score, recordedAt }) => ({ score, recordedAt })),
  };
}

export async function getPlayerScore(
  gameName: string,
  tagLine: string,
  platform: string,
): Promise<number | null> {
  const player = await resolvePlayer(gameName, tagLine, platform);

  const [latest] = await getScoreHistory(player.id, { limit: 1 });
  if (!canRefreshPlayer(latest?.recordedAt ?? null)) {
    return latest?.score ?? null;
  }

  const ranked = await getLeagueEntriesByPuuid(player.puuid, platform);
  const soloRanked = toSoloRanked(ranked);
  const score = soloRanked?.score ?? null;

  await recordScoreSnapshot(player.id, score);
  await touchPlayer(player.id);

  return score;
}
