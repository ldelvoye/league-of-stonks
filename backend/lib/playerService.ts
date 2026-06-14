import type { Player } from "../db/tables/players.js";
import { findPlayerByRiotId, touchPlayer, upsertPlayer } from "../db/tables/players.js";
import {
  getLatestConfirmedMatchId,
  getScoreHistory,
  recordMatchScoreSnapshot,
  recordScoreSnapshot,
} from "../db/tables/scores.js";
import { canRefreshPlayer } from "./cooldown.js";
import {
  getAccountByRiotId,
  getLeagueEntriesByPuuid,
  getMatchById,
  getRankedSoloMatchIdsByPuuid,
  type RiotMatch,
} from "./riot.js";
import { toSoloRanked } from "./rank.js";

const MATCH_SYNC_DEPTH = 10;

// Single-flight map: deduplicate concurrent Riot syncs for the same player.
// Keyed by normalized platform/gameName/tagLine so even cold-cache concurrent
// requests collapse before resolvePlayer() reaches Riot account lookup.
const activePlayerSyncs = new Map<string, Promise<number | null>>();
const LOBBY_SNAPSHOT_MAX_PLAYERS = 9;
const DEFAULT_LP_SWING = 20;
const MIN_LP_SWING = 8;
const MAX_LP_SWING_STABLE = 40;
const MAX_LP_SWING_PROVISIONAL = 200;
const SPARSE_ANCHOR_SAMPLE_COUNT = 4;
const STABLE_CONFIRMED_SEGMENTS = 2;

interface SegmentSample {
  wins: number;
  losses: number;
  delta: number;
  weight: number;
  strongAnchor: boolean;
  perGameSwing: number;
}

interface LpEstimateProfile {
  winGain: number;
  lossLoss: number;
}

type ScoreHistoryRows = Awaited<ReturnType<typeof getScoreHistory>>;
type ScoreHistoryRow = ScoreHistoryRows[number];

function playerSyncKey(gameName: string, tagLine: string, platform: string): string {
  return `${platform.trim().toLowerCase()}:${gameName.trim().toLowerCase()}#${tagLine.trim().toLowerCase()}`;
}

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

interface MatchPoint {
  matchId: string;
  gameEndedAt: Date;
  won: boolean;
  championName: string | null;
  queueId: number;
}

function extractPlayerMatchPoint(match: RiotMatch, puuid: string): MatchPoint | null {
  const participant = match.info.participants.find((entry) => entry.puuid === puuid);
  if (!participant) {
    return null;
  }

  return {
    matchId: match.metadata.matchId,
    gameEndedAt: new Date(match.info.gameEndTimestamp),
    won: participant.win,
    championName: participant.championName ?? null,
    queueId: match.info.queueId,
  };
}

function clampLpSwing(value: number, maxSwing: number): number {
  return Math.max(MIN_LP_SWING, Math.min(maxSwing, value));
}

function percentile(values: number[], quantile: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }

  const q = Math.max(0, Math.min(1, quantile));
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const ratio = position - lower;
  return sorted[lower] * (1 - ratio) + sorted[upper] * ratio;
}

function inferMaxSwing(samples: SegmentSample[]): number {
  if (samples.length === 0) {
    return MAX_LP_SWING_STABLE;
  }

  const strongSegmentCount = samples.filter((sample) => sample.strongAnchor).length;
  const sparseAnchors =
    strongSegmentCount < STABLE_CONFIRMED_SEGMENTS && samples.length < SPARSE_ANCHOR_SAMPLE_COUNT;
  const observedP85 = percentile(
    samples.map((sample) => sample.perGameSwing),
    0.85,
  );
  const observedCeiling = observedP85 ?? DEFAULT_LP_SWING;

  // Placements/provisional MMR can swing much harder. Widen caps when anchor
  // data is sparse so we do not flatten legitimate jumps.
  const dynamicMax = sparseAnchors
    ? Math.max(MAX_LP_SWING_STABLE, observedCeiling * 2.4, 60)
    : Math.max(MAX_LP_SWING_STABLE, observedCeiling * 1.6);

  return Math.min(MAX_LP_SWING_PROVISIONAL, Math.round(dynamicMax));
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values
    .filter((entry) => Number.isFinite(entry.value) && entry.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (sorted.length === 0) {
    return null;
  }

  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= totalWeight / 2) {
      return entry.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

function sourceWeight(sourceA: "snapshot" | "confirmed" | "estimated", sourceB: "snapshot" | "confirmed" | "estimated"): number {
  if (sourceA === "confirmed" && sourceB === "confirmed") {
    return 1;
  }
  if (sourceA === "estimated" || sourceB === "estimated") {
    return 0.25;
  }
  return 0.65;
}

function collectSegmentSamples(historyDesc: Awaited<ReturnType<typeof getScoreHistory>>): SegmentSample[] {
  const ordered = historyDesc.slice().reverse();
  const anchorIndexes = ordered
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(
      ({ snapshot }) =>
        snapshot.score !== null &&
        snapshot.matchId &&
        (snapshot.source === "confirmed" || snapshot.source === "snapshot"),
    );

  const samples: SegmentSample[] = [];
  for (let i = 1; i < anchorIndexes.length; i += 1) {
    const older = anchorIndexes[i - 1];
    const newer = anchorIndexes[i];
    if (older.snapshot.score == null || newer.snapshot.score == null) {
      continue;
    }

    let wins = 0;
    let losses = 0;
    for (let idx = older.index + 1; idx <= newer.index; idx += 1) {
      const row = ordered[idx];
      if (!row.matchId || row.won == null) {
        continue;
      }
      if (row.won) wins += 1;
      else losses += 1;
    }

    if (wins + losses === 0) {
      continue;
    }

    samples.push({
      wins,
      losses,
      delta: newer.snapshot.score - older.snapshot.score,
      weight: sourceWeight(older.snapshot.source, newer.snapshot.source),
      strongAnchor: older.snapshot.source === "confirmed" && newer.snapshot.source === "confirmed",
      perGameSwing: Math.abs(newer.snapshot.score - older.snapshot.score) / Math.max(1, wins + losses),
    });
  }
  return samples;
}

function inferLpEstimateProfile(historyDesc: Awaited<ReturnType<typeof getScoreHistory>>): LpEstimateProfile {
  const samples = collectSegmentSamples(historyDesc);
  if (samples.length === 0) {
    return { winGain: DEFAULT_LP_SWING, lossLoss: DEFAULT_LP_SWING };
  }

  const symmetricMedian = weightedMedian(
    samples.map((sample) => ({
      value: Math.abs(sample.delta) / Math.max(1, sample.wins + sample.losses),
      weight: sample.weight * (sample.wins + sample.losses),
    })),
  );
  const maxSwing = inferMaxSwing(samples);
  const baseline = clampLpSwing(symmetricMedian ?? DEFAULT_LP_SWING, maxSwing);

  let m11 = 0;
  let m12 = 0;
  let m22 = 0;
  let r1 = 0;
  let r2 = 0;

  for (const sample of samples) {
    const c1 = sample.wins;
    const c2 = -sample.losses;
    const w = sample.weight;
    m11 += w * c1 * c1;
    m12 += w * c1 * c2;
    m22 += w * c2 * c2;
    r1 += w * c1 * sample.delta;
    r2 += w * c2 * sample.delta;
  }

  const regularizationWeight = 0.6;
  m11 += regularizationWeight;
  m22 += regularizationWeight;
  r1 += regularizationWeight * baseline;
  r2 += regularizationWeight * baseline;

  const determinant = m11 * m22 - m12 * m12;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) {
    return { winGain: baseline, lossLoss: baseline };
  }

  const inferredWin = clampLpSwing((r1 * m22 - r2 * m12) / determinant, maxSwing);
  const inferredLoss = clampLpSwing((m11 * r2 - m12 * r1) / determinant, maxSwing);

  if (!Number.isFinite(inferredWin) || !Number.isFinite(inferredLoss)) {
    return { winGain: baseline, lossLoss: baseline };
  }

  return { winGain: inferredWin, lossLoss: inferredLoss };
}

function estimatePreviousScore(
  afterGameScore: number | null,
  won: boolean,
  profile: LpEstimateProfile,
): number | null {
  if (afterGameScore === null) {
    return null;
  }

  const estimated = afterGameScore - (won ? profile.winGain : -profile.lossLoss);
  return Math.max(0, estimated);
}

function shouldSkipSyncForCooldown(latest: ScoreHistoryRow | undefined): boolean {
  return Boolean(latest && !canRefreshPlayer(latest.recordedAt) && latest.source !== "snapshot");
}

function getPendingMatchIds(matchIds: string[], latestConfirmedMatchId: string | null): string[] {
  const pending: string[] = [];
  for (const matchId of matchIds) {
    if (latestConfirmedMatchId && matchId === latestConfirmedMatchId) {
      break;
    }
    pending.push(matchId);
  }
  return pending;
}

async function fetchMatchesAndPoints(
  matchIds: string[],
  puuid: string,
): Promise<{ matches: RiotMatch[]; targetMatchPoints: MatchPoint[] }> {
  const matches: RiotMatch[] = [];
  for (const matchId of matchIds) {
    matches.push(await getMatchById(matchId));
  }

  const targetMatchPoints = matches
    .map((match) => extractPlayerMatchPoint(match, puuid))
    .filter((point): point is MatchPoint => point !== null);

  return { matches, targetMatchPoints };
}

async function resolveCurrentScoreForBackfill(
  player: Player,
  platform: string,
  latest: ScoreHistoryRow | undefined,
  newestPendingMatch: MatchPoint,
): Promise<number | null> {
  const canUseLocalAnchorScore =
    latest &&
    latest.source === "snapshot" &&
    latest.recordedAt.getTime() >= newestPendingMatch.gameEndedAt.getTime();
  if (canUseLocalAnchorScore && latest) {
    return latest.score;
  }

  const ranked = await getLeagueEntriesByPuuid(player.puuid, platform);
  const soloRanked = toSoloRanked(ranked);
  return soloRanked?.score ?? null;
}

async function snapshotLatestLobbyPlayers(match: RiotMatch, targetPlayer: Player, platform: string): Promise<void> {
  const participants = match.info.participants
    .filter((entry) => entry.puuid !== targetPlayer.puuid)
    .slice(0, LOBBY_SNAPSHOT_MAX_PLAYERS);

  for (const participant of participants) {
    if (!participant.riotIdGameName || !participant.riotIdTagline) {
      continue;
    }

    const lobbyPlayer = await upsertPlayer({
      gameName: participant.riotIdGameName,
      tagLine: participant.riotIdTagline,
      puuid: participant.puuid,
      platform,
    });

    const [latestSnapshot] = await getScoreHistory(lobbyPlayer.playerId, { limit: 1 });

    let score: number | null;
    if (latestSnapshot && !canRefreshPlayer(latestSnapshot.recordedAt)) {
      score = latestSnapshot.score;
    } else {
      const ranked = await getLeagueEntriesByPuuid(participant.puuid, platform);
      const soloRanked = toSoloRanked(ranked);
      score = soloRanked?.score ?? null;
    }

    await recordMatchScoreSnapshot({
      playerId: lobbyPlayer.playerId,
      matchId: match.metadata.matchId,
      score,
      gameEndedAt: new Date(match.info.gameEndTimestamp),
      source: "snapshot",
      won: participant.win,
      championName: participant.championName ?? null,
      queueId: match.info.queueId,
    });
    await touchPlayer(lobbyPlayer.playerId);
  }
}

async function recordCurrentLeagueSnapshot(player: Player, platform: string): Promise<number | null> {
  const ranked = await getLeagueEntriesByPuuid(player.puuid, platform);
  const soloRanked = toSoloRanked(ranked);
  const score = soloRanked?.score ?? null;

  await recordScoreSnapshot(player.playerId, score);
  await touchPlayer(player.playerId);
  return score;
}

async function refreshPlayerScoreIfNeeded(player: Player, platform: string): Promise<number | null> {
  const [latest] = await getScoreHistory(player.playerId, { limit: 1 });
  const latestConfirmedMatchId = await getLatestConfirmedMatchId(player.playerId);
  if (shouldSkipSyncForCooldown(latest)) {
    return latest?.score ?? null;
  }

  const matchIds = await getRankedSoloMatchIdsByPuuid(player.puuid, { count: MATCH_SYNC_DEPTH });
  if (matchIds.length > 0 && latestConfirmedMatchId && matchIds[0] === latestConfirmedMatchId) {
    return latest?.score ?? (await recordCurrentLeagueSnapshot(player, platform));
  }

  const pendingMatchIds = getPendingMatchIds(matchIds, latestConfirmedMatchId);

  if (pendingMatchIds.length === 0) {
    if (latest) {
      return latest.score;
    }
    return recordCurrentLeagueSnapshot(player, platform);
  }

  const { matches, targetMatchPoints } = await fetchMatchesAndPoints(pendingMatchIds, player.puuid);

  if (targetMatchPoints.length === 0) {
    if (latest) {
      return latest.score;
    }
    return recordCurrentLeagueSnapshot(player, platform);
  }

  const currentScore = await resolveCurrentScoreForBackfill(
    player,
    platform,
    latest,
    targetMatchPoints[0],
  );

  const estimateProfile = inferLpEstimateProfile(await getScoreHistory(player.playerId, { limit: 200 }));
  let rollingScore = currentScore;
  for (let index = 0; index < targetMatchPoints.length; index += 1) {
    const point = targetMatchPoints[index];
    const source = index === 0 ? "confirmed" : "estimated";
    const pointScore = index === 0 ? currentScore : rollingScore;

    await recordMatchScoreSnapshot({
      playerId: player.playerId,
      matchId: point.matchId,
      score: pointScore,
      gameEndedAt: point.gameEndedAt,
      source,
      won: point.won,
      championName: point.championName,
      queueId: point.queueId,
    });

    rollingScore = estimatePreviousScore(pointScore, point.won, estimateProfile);
  }

  await touchPlayer(player.playerId);

  await snapshotLatestLobbyPlayers(matches[0], player, platform);

  return currentScore;
}

export interface PlayerHistory {
  gameName: string;
  tagLine: string;
  history: Array<{
    score: number | null;
    recordedAt: Date;
    matchId?: string | null;
    source?: "snapshot" | "confirmed" | "estimated";
    won?: boolean | null;
    championName?: string | null;
  }>;
}

function toPlayerHistory(player: Player, history: Awaited<ReturnType<typeof getScoreHistory>>): PlayerHistory {
  return {
    gameName: player.gameName,
    tagLine: player.tagLine,
    history: history
      .reverse()
      .map(({ score, recordedAt, matchId, source, won, championName }) => ({
        score,
        recordedAt,
        matchId,
        source,
        won,
        championName,
      })),
  };
}

async function getCachedPlayerHistory(
  gameName: string,
  tagLine: string,
  platform: string,
  limit: number,
): Promise<{ player: Player; history: ScoreHistoryRows } | null> {
  const player = await findPlayerByRiotId(gameName, tagLine, platform);
  if (!player) {
    return null;
  }
  const history = await getScoreHistory(player.playerId, { limit });
  return { player, history };
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
  return toPlayerHistory(player, history);
}

interface RefreshPlayerScoreOptions {
  allowStaleWhileSyncing?: boolean;
}

async function refreshPlayerScoreDeduped(
  gameName: string,
  tagLine: string,
  platform: string,
  { allowStaleWhileSyncing = false }: RefreshPlayerScoreOptions = {},
): Promise<number | null> {
  const key = playerSyncKey(gameName, tagLine, platform);
  const existing = activePlayerSyncs.get(key);
  if (existing) {
    // Bound request latency during bursts: if a sync is already in-flight and
    // we have cached data, return it immediately instead of awaiting Riot.
    if (allowStaleWhileSyncing) {
      const cached = await getCachedPlayerHistory(gameName, tagLine, platform, 1);
      if (cached?.history.length) {
        return cached.history[0].score;
      }
    }
    return existing;
  }

  const sync = (async () => {
    const player = await resolvePlayer(gameName, tagLine, platform);
    return refreshPlayerScoreIfNeeded(player, platform);
  })().finally(() => {
    activePlayerSyncs.delete(key);
  });
  activePlayerSyncs.set(key, sync);
  return sync;
}

export async function getPlayerScore(
  gameName: string,
  tagLine: string,
  platform: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<number | null> {
  if (!refresh) {
    const cached = await getCachedPlayerHistory(gameName, tagLine, platform, 1);
    if (cached?.history.length) {
      return cached.history[0].score;
    }
  }

  return refreshPlayerScoreDeduped(gameName, tagLine, platform, {
    allowStaleWhileSyncing: refresh,
  });
}

export async function getPlayerScoreAndHistory(
  gameName: string,
  tagLine: string,
  platform: string,
  { limit = 100, refresh = false }: { limit?: number; refresh?: boolean } = {},
): Promise<PlayerHistory> {
  if (!refresh) {
    const cached = await getCachedPlayerHistory(gameName, tagLine, platform, limit);
    if (cached && cached.history.length > 0) {
      return toPlayerHistory(cached.player, cached.history);
    }
  }

  await refreshPlayerScoreDeduped(gameName, tagLine, platform, {
    allowStaleWhileSyncing: refresh,
  });

  const cached = await getCachedPlayerHistory(gameName, tagLine, platform, limit);
  if (cached) {
    return toPlayerHistory(cached.player, cached.history);
  }

  const player = await resolvePlayer(gameName, tagLine, platform);
  const history = await getScoreHistory(player.playerId, { limit });
  return toPlayerHistory(player, history);
}
