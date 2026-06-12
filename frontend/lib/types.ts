// Shared data shapes used across the frontend.

export interface RiotId {
  gameName: string;
  tagLine: string;
}

export interface Snapshot {
  score: number | null;
  recordedAt: string;
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
