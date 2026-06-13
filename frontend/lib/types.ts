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

export type PortfolioTradeSide = "buy" | "sell";

export interface PortfolioPosition {
  playerId: number;
  gameName: string;
  tagLine: string;
  platform: string;
  shares: string;
  avgCost: string;
  currentPrice: string | null;
  totalCost: string;
  marketValue: string | null;
  unrealizedGain: string | null;
  unrealizedGainPct: string | null;
}

export interface PortfolioTrade {
  tradeId: number;
  playerId: number;
  gameName: string;
  tagLine: string;
  platform: string;
  side: PortfolioTradeSide;
  shares: string;
  pricePerShare: string;
  totalValue: string;
  executedAt: string;
}

export interface PortfolioSnapshot {
  portfolioId: number;
  userId: number;
  lpBalance: string;
  positions: PortfolioPosition[];
  trades: PortfolioTrade[];
}

export interface ExecuteTradeResult {
  trade: PortfolioTrade;
  portfolio: PortfolioSnapshot;
}

export interface TopPerformer {
  gameName: string;
  tagLine: string;
  currentScore: number;
  baselineScore: number;
  deltaLp: number;
  deltaPct: number | null;
}

export interface RecentTrade {
  tradeId: number;
  gameName: string;
  tagLine: string;
  side: "buy" | "sell";
  shares: string;
  pricePerShare: string;
  totalValue: string;
  executedAt: string;
}

export interface MarketStats {
  trackedSummoners: number;
  totalTrades: number;
  volume24h: string;
}
