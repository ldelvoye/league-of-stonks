// Shared data shapes used across the frontend.

export interface RiotId {
  gameName: string;
  tagLine: string;
}

export interface Snapshot {
  score: number | null;
  recordedAt: string;
  matchId?: string | null;
  source?: "snapshot" | "confirmed" | "estimated";
  won?: boolean | null;
  championName?: string | null;
}

export interface PlayerHistory {
  gameName: string;
  tagLine: string;
  history: Snapshot[];
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

export type MessageVariant = "error" | "loading" | "info";

export interface AuthUser {
  userId: number;
  email: string;
  username: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
}

export interface ApiErrorBody {
  error?: string;
}

export interface ProfileFieldChangeStatus {
  allowed: boolean;
  retryAfterMs: number;
  message: string | null;
}

export interface ProfileChangeStatus {
  username: ProfileFieldChangeStatus;
  email: ProfileFieldChangeStatus;
}
