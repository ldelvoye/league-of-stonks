import type { Player } from "../db/tables/players.js";
import { findPlayerByRiotId, touchPlayer, upsertPlayer } from "../db/tables/players.js";
import { getScoreHistory, recordScoreSnapshot } from "../db/tables/scores.js";
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

async function refreshPlayerScoreIfNeeded(player: Player, platform: string): Promise<number | null> {
  const [latest] = await getScoreHistory(player.playerId, { limit: 1 });
  if (!canRefreshPlayer(latest?.recordedAt ?? null)) {
    return latest?.score ?? null;
  }

  const ranked = await getLeagueEntriesByPuuid(player.puuid, platform);
  const soloRanked = toSoloRanked(ranked);
  const score = soloRanked?.score ?? null;

  await recordScoreSnapshot(player.playerId, score);
  await touchPlayer(player.playerId);

  return score;
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

  const history = await getScoreHistory(player.playerId, { limit });
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
  return refreshPlayerScoreIfNeeded(player, platform);
}

export async function getPlayerScoreAndHistory(
  gameName: string,
  tagLine: string,
  platform: string,
  { limit = 100 }: { limit?: number } = {},
): Promise<PlayerHistory> {
  const player = await resolvePlayer(gameName, tagLine, platform);
  await refreshPlayerScoreIfNeeded(player, platform);

  const history = await getScoreHistory(player.playerId, { limit });
  return {
    gameName: player.gameName,
    tagLine: player.tagLine,
    history: history.reverse().map(({ score, recordedAt }) => ({ score, recordedAt })),
  };
}
