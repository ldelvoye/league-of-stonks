// Data-access layer: everything that talks to the backend lives here, mirroring
// the backend's db/ layer. No DOM access.
import type {
  ApiErrorBody,
  ApiResult,
  AuthUser,
  ExecuteTradeResult,
  MarketStats,
  PortfolioSnapshot,
  PortfolioTradeSide,
  PlayerHistory,
  ProfileChangeStatus,
  RecentTrade,
  TopPerformer,
} from "./types.js";
import { PORTFOLIO_CONFLICT_CODES } from "../../backend/lib/portfolioConflictCodes.js";
import { SEASON_16_KEY, type SupportedSeasonKey } from "../../backend/lib/seasons.js";

/**
 * Thrown by query/mutation functions when a credentialed request receives a
 * 401. The global QueryCache / MutationCache error handler in main.tsx catches
 * this and invalidates the auth session so the UI can redirect to /login.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired. Please sign in again.");
    this.name = "SessionExpiredError";
  }
}

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

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function apiGet<T>(path: string, credentials = false): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
      credentials: credentials ? "include" : "same-origin",
    });
    const data = await parseJson<T>(response);
    return { ok: response.ok, status: response.status, data };
  } catch {
    // TypeError means the fetch itself failed (network down, CORS, DNS).
    // Preserve this distinction so callers can show a better error message.
    return { ok: false, status: 0, data: null, networkError: true };
  }
}

async function apiPost<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJson<T>(response);
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null, networkError: true };
  }
}

function authPath(suffix: string): string {
  return `${API_BASE_URL}/api/auth${suffix}`;
}

function portfolioPath(suffix = ""): string {
  return `${API_BASE_URL}/api/portfolio${suffix}`;
}

function marketPath(suffix = ""): string {
  return `${API_BASE_URL}/api/market${suffix}`;
}

export interface GetScoreAndHistoryOptions {
  refresh?: boolean;
  season?: SupportedSeasonKey;
}

export const PLAYER_HISTORY_SEASON_S16 = SEASON_16_KEY;

export const getScoreAndHistory = (
  gameName: string,
  tagLine: string,
  limit = 100,
  { refresh = false, season }: GetScoreAndHistoryOptions = {},
) => {
  const params = new URLSearchParams({
    includeHistory: "1",
    limit: String(limit),
  });
  if (refresh) {
    params.set("refresh", "1");
  }
  if (season) {
    params.set("season", season);
  }
  return apiGet<PlayerHistory>(`${playerPath(gameName, tagLine)}?${params.toString()}`);
};

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
      return "Something went wrong while fetching price data. Please try again.";
  }
}

export const register = (username: string, email: string, password: string) =>
  apiPost<AuthUser>(authPath("/register"), { username, email, password });

export const login = (identifier: string, password: string) =>
  apiPost<AuthUser>(authPath("/login"), { identifier, password });

export const logout = () => apiPost<{ ok: boolean }>(authPath("/logout"));

export const getMe = () => apiGet<AuthUser>(authPath("/me"), true);
export const getProfileChangeStatus = () =>
  apiGet<ProfileChangeStatus>(authPath("/profile-change-status"), true);

export const verifyEmail = (token: string) =>
  apiPost<{ ok: boolean }>(authPath("/verify-email"), { token });

export const resendVerification = () =>
  apiPost<{ ok: boolean }>(authPath("/resend-verification"));

export const forgotPassword = (email: string) =>
  apiPost<{ ok: boolean }>(authPath("/forgot-password"), { email });

export const requestPasswordReset = () =>
  apiPost<{ ok: boolean }>(authPath("/request-password-reset"));

export const resetPassword = (token: string, password: string) =>
  apiPost<{ ok: boolean }>(authPath("/reset-password"), { token, password });

export const updateAccountProfile = (username: string, email: string, password: string) =>
  apiPost<AuthUser>(authPath("/update-profile"), { username, email, password });

export const getPortfolio = () => apiGet<PortfolioSnapshot>(portfolioPath(), true);

export const executeTrade = (
  gameName: string,
  tagLine: string,
  side: PortfolioTradeSide,
  shares: string,
  expectedPricePerShare: string,
) =>
  apiPost<ExecuteTradeResult>(portfolioPath("/trades"), {
    gameName,
    tagLine,
    side,
    shares,
    expectedPricePerShare,
  });

export const getMarketStats = () =>
  apiGet<MarketStats>(marketPath("/stats"));

export const getTopPerformers = ({ limit = 10, windowDays = 30 }: { limit?: number; windowDays?: number } = {}) =>
  apiGet<TopPerformer[]>(marketPath(`/top?limit=${limit}&window=${windowDays}`));

export const getRecentTrades = ({ limit = 20 }: { limit?: number } = {}) =>
  apiGet<RecentTrade[]>(marketPath(`/recent-trades?limit=${limit}`));

export function authErrorMessage(status: number, data: ApiErrorBody | null): string {
  if (data?.error) return data.error;
  switch (status) {
    case 401:
      return "Invalid email/username or password.";
    case 409:
      return "Email or username already in use.";
    case 429:
      return "Too many attempts, please try again later.";
    case 0:
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function portfolioErrorMessage(status: number, data: ApiErrorBody | null): string {
  if (status === 409) {
    if (data?.code === PORTFOLIO_CONFLICT_CODES.HISTORY_CHANGED) {
      return "Share history changed while processing your order. Review the updated history and try again.";
    }
    if (data?.code === PORTFOLIO_CONFLICT_CODES.PRICE_CHANGED) {
      return "Price changed while processing your order. Review the updated price and try again.";
    }
    if (data?.error) return data.error;
    return "Market data changed while processing your order. Review the latest data and try again.";
  }

  if (data?.error) return data.error;
  switch (status) {
    case 401:
      return "Sign in to access your portfolio.";
    case 403:
      return "Verify your email to access your portfolio.";
    case 404:
      return "Portfolio data was not found.";
    case 429:
      return "Too many requests, please try again shortly.";
    case 0:
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "Something went wrong with your portfolio request.";
  }
}
