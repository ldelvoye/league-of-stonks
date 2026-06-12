// Data-access layer: everything that talks to the backend lives here, mirroring
// the backend's db/ layer. No DOM access.
import type { ApiResult, PlayerHistory } from "./types.js";

function apiBaseUrl(): string {
  const configured = (globalThis as typeof globalThis & { __API_BASE_URL__?: unknown })
    .__API_BASE_URL__;
  if (typeof configured === "string" && configured.trim()) {
    return configured.replace(/\/+$/, "");
  }

  // Split local setup: frontend on :3001 and backend API on :3000.
  if (window.location.hostname === "localhost" && window.location.port === "3001") {
    return "http://localhost:3000";
  }

  // Frontend and backend are deployed separately in production.
  return "https://api.leagueofstonks.com";
}

const API_BASE_URL = apiBaseUrl();

function playerPath(gameName: string, tagLine: string, suffix = ""): string {
  return `${API_BASE_URL}/api/player/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}${suffix}`;
}

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const getHistory = (gameName: string, tagLine: string) =>
  apiGet<PlayerHistory>(playerPath(gameName, tagLine, "/history"));

export const getScore = (gameName: string, tagLine: string) =>
  apiGet<{ score: number | null }>(playerPath(gameName, tagLine));

export function scoreErrorMessage(status: number): string {
  switch (status) {
    case 404:
      return "Player not found.";
    case 429:
      return "Riot API rate limit reached. Please try again in a moment.";
    case 502:
      return "Riot API is unavailable right now. Please try again later.";
    case 0:
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "Something went wrong while fetching the score. Please try again.";
  }
}
