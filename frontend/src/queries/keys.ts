/**
 * Centralized query key factory. Import these constants everywhere instead of
 * writing raw key arrays so key shapes stay consistent across queries,
 * invalidations, and cache writes.
 */
export const queryKeys = {
  auth: {
    me: () => ["auth", "me"] as const,
  },

  player: {
    detail: (gameName: string, tagLine: string) =>
      ["player", gameName, tagLine] as const,
  },

  market: {
    stats: () => ["market", "stats"] as const,
    top: (limit: number, windowDays: number) =>
      ["market", "top", limit, windowDays] as const,
    recentTrades: (limit: number) => ["market", "recent-trades", limit] as const,
  },

  portfolio: {
    detail: () => ["portfolio"] as const,
  },
};
