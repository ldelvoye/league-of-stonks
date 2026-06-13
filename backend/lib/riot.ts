import type { Request } from "express";
import type { LeagueEntry } from "./rank.js";

const AMERICAS_BASE_URL = "https://americas.api.riotgames.com";
const RANKED_SOLO_QUEUE_ID = 420;

// TODO: derive platform from request (e.g. query param, subdomain, or user setting)
export function getPlatform(_req: Request): string {
  return "na1";
}

export function platformBaseUrl(platform: string): string {
  return `https://${platform}.api.riotgames.com`;
}

function getApiKey(): string {
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    throw new Error("RIOT_API_KEY is not configured");
  }
  return apiKey;
}

export class RiotApiError extends Error {
  step: string;
  status: number;
  data: unknown;

  constructor(step: string, status: number, data: unknown) {
    super(`${step} lookup failed`);
    this.name = "RiotApiError";
    this.step = step;
    this.status = status;
    this.data = data;
  }
}

async function riotFetch<T>(url: string, step: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "X-Riot-Token": getApiKey(),
    },
  });

  const body = await response.text();
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }

  if (!response.ok) {
    throw new RiotApiError(step, response.status, data);
  }

  return data as T;
}

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
): Promise<RiotAccount> {
  const url = `${AMERICAS_BASE_URL}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch<RiotAccount>(url, "account");
}

export async function getLeagueEntriesByPuuid(
  puuid: string,
  platform: string,
): Promise<LeagueEntry[]> {
  const url = `${platformBaseUrl(platform)}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
  return riotFetch<LeagueEntry[]>(url, "league");
}

export interface RiotMatchParticipant {
  puuid: string;
  win: boolean;
  championName: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
}

export interface RiotMatch {
  metadata: {
    matchId: string;
  };
  info: {
    gameEndTimestamp: number;
    queueId: number;
    participants: RiotMatchParticipant[];
  };
}

export interface MatchIdListOptions {
  start?: number;
  count?: number;
}

export async function getRankedSoloMatchIdsByPuuid(
  puuid: string,
  { start = 0, count = 10 }: MatchIdListOptions = {},
): Promise<string[]> {
  const params = new URLSearchParams({
    start: String(Math.max(0, start)),
    count: String(Math.max(1, Math.min(100, count))),
    queue: String(RANKED_SOLO_QUEUE_ID),
    type: "ranked",
  });
  const url = `${AMERICAS_BASE_URL}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params.toString()}`;
  return riotFetch<string[]>(url, "match-list");
}

export async function getMatchById(matchId: string): Promise<RiotMatch> {
  const url = `${AMERICAS_BASE_URL}/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetch<RiotMatch>(url, "match");
}
