import type { Request } from "express";
import type { LeagueEntry } from "./rank.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const AMERICAS_BASE_URL = "https://americas.api.riotgames.com";
const RANKED_SOLO_QUEUE_ID = 420;

// ── Outbound rate limiter ─────────────────────────────────────────────────────
// Tracks timestamps of outbound Riot requests to enforce both API rate windows.
// Node.js is single-threaded so no mutex is needed; concurrent async paths are
// serialized by the event loop, making the array safe to read/write without locks.

const SHORT_WINDOW_MS = 1_000;     // 1 second
const LONG_WINDOW_MS = 2 * 60 * 1_000; // 2 minutes
const STATS_WINDOW_MS = 15 * 60 * 1_000; // 15 minutes for usage stats

// Timestamps (ms) of every dispatched Riot request within the long window.
const outboundTimestamps: number[] = [];

interface RequestRecord {
  ts: number;
  step: string;
  was429: boolean;
}
// Records of all requests within the stats window for budget queries.
const requestHistory: RequestRecord[] = [];

function pruneOutboundTimestamps(now: number): void {
  const cutoff = now - LONG_WINDOW_MS;
  while (outboundTimestamps.length > 0 && outboundTimestamps[0] < cutoff) {
    outboundTimestamps.shift();
  }
}

function pruneRequestHistory(now: number): void {
  const cutoff = now - STATS_WINDOW_MS;
  while (requestHistory.length > 0 && requestHistory[0].ts < cutoff) {
    requestHistory.shift();
  }
}

/** Waits until there is capacity in both Riot API rate windows, then reserves a slot. */
async function acquireRiotSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    pruneOutboundTimestamps(now);

    const shortCutoff = now - SHORT_WINDOW_MS;
    const inShortWindow = outboundTimestamps.filter((t) => t >= shortCutoff).length;
    const inLongWindow = outboundTimestamps.length;

    const shortLimit = config.riotOutboundLimitPerSecond();
    const longLimit = config.riotOutboundLimitPer2Min();

    if (inShortWindow < shortLimit && inLongWindow < longLimit) {
      outboundTimestamps.push(now);
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

export interface RiotUsageStats {
  last15mTotal: number;
  last15m429s: number;
  last2mTotal: number;
  availableShortBudget: number;
  availableLongBudget: number;
}

/** Returns a snapshot of outbound Riot API usage for budget-aware cron decisions. */
export function getRiotUsageStats(): RiotUsageStats {
  const now = Date.now();
  pruneRequestHistory(now);
  pruneOutboundTimestamps(now);

  const shortCutoff = now - SHORT_WINDOW_MS;
  const longCutoff = now - LONG_WINDOW_MS;

  const last2mTotal = outboundTimestamps.filter((t) => t >= longCutoff).length;
  const inShortWindow = outboundTimestamps.filter((t) => t >= shortCutoff).length;

  const last15m429s = requestHistory.filter((r) => r.was429).length;

  return {
    last15mTotal: requestHistory.length,
    last15m429s,
    last2mTotal,
    availableShortBudget: Math.max(0, config.riotOutboundLimitPerSecond() - inShortWindow),
    availableLongBudget: Math.max(0, config.riotOutboundLimitPer2Min() - last2mTotal),
  };
}

// TODO: derive platform from request (e.g. query param, subdomain, or user setting)
export function getPlatform(_req: Request): string {
  return "na1";
}

export function platformBaseUrl(platform: string): string {
  return `https://${platform}.api.riotgames.com`;
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

function isHighVolumeStep(step: string): boolean {
  return step === "match" || step === "league";
}

async function riotFetch<T>(url: string, step: string): Promise<T> {
  await acquireRiotSlot();

  const startMs = Date.now();

  const response = await fetch(url, {
    headers: {
      "X-Riot-Token": config.riotApiKey(),
    },
  });

  const latencyMs = Date.now() - startMs;
  const was429 = response.status === 429;
  requestHistory.push({ ts: Date.now(), step, was429 });
  pruneRequestHistory(Date.now());

  const body = await response.text();
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }

  if (!response.ok) {
    if (was429) {
      logger.warn("Riot API request rate limited", {
        event: "riot.request.rate_limited",
        category: "riot",
        action: "request",
        outcome: "rate_limited",
        step,
        riotStatus: response.status,
        latencyMs,
      });
    } else {
      logger.error("Riot API request failed", {
        event: "riot.request.failed",
        category: "riot",
        action: "request",
        outcome: "failure",
        step,
        riotStatus: response.status,
        latencyMs,
      });
    }
    throw new RiotApiError(step, response.status, data);
  }

  if (!isHighVolumeStep(step) || config.logVerboseRiotRequests()) {
    logger.info("Riot API request succeeded", {
      event: "riot.request.succeeded",
      category: "riot",
      action: "request",
      outcome: "success",
      step,
      riotStatus: response.status,
      latencyMs,
    });
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
