const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
];

const RANKS: Record<string, number> = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
};

const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

const POINTS_PER_RANK = 100;
const POINTS_PER_TIER = Object.keys(RANKS).length * POINTS_PER_RANK;
const APEX_BASE_SCORE = TIERS.length * POINTS_PER_TIER;

export function rankToScore(
  tier: string,
  rank: string,
  leaguePoints: number,
): number | null {
  const lp = leaguePoints ?? 0;

  if (APEX_TIERS.has(tier)) {
    return Math.max(0, APEX_BASE_SCORE + lp);
  }

  const tierIndex = TIERS.indexOf(tier);
  if (tierIndex === -1 || !(rank in RANKS)) {
    return null;
  }

  const score = tierIndex * POINTS_PER_TIER + RANKS[rank] * POINTS_PER_RANK + lp;
  return Math.max(0, score);
}

export interface LeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
}

export interface SoloRanked {
  tier: string;
  rank: string;
  leaguePoints: number;
  score: number | null;
}

export function getSoloRankedEntry(entries: LeagueEntry[]): LeagueEntry | null {
  return entries.find((entry) => entry.queueType === "RANKED_SOLO_5x5") ?? null;
}

export function toSoloRanked(entries: LeagueEntry[]): SoloRanked | null {
  const entry = getSoloRankedEntry(entries);
  if (!entry) {
    return null;
  }

  return {
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
    score: rankToScore(entry.tier, entry.rank, entry.leaguePoints),
  };
}
