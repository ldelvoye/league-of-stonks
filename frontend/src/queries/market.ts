import { useQuery } from "@tanstack/react-query";
import { getMarketStats, getTopPerformers, getRecentTrades } from "../../lib/api.js";
import { queryKeys } from "./keys.js";

export function useMarketStats() {
  return useQuery({
    queryKey: queryKeys.market.stats(),
    queryFn: async () => {
      const result = await getMarketStats();
      if (!result.ok || !result.data) throw new Error("Failed to load market stats");
      return result.data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useTopPerformers({
  limit = 10,
  windowDays = 30,
}: { limit?: number; windowDays?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.market.top(limit, windowDays),
    queryFn: async () => {
      const result = await getTopPerformers({ limit, windowDays });
      if (!result.ok || !result.data) throw new Error("Failed to load top performers");
      return result.data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useRecentTrades({ limit = 10 }: { limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.market.recentTrades(limit),
    queryFn: async () => {
      const result = await getRecentTrades({ limit });
      if (!result.ok || !result.data) throw new Error("Failed to load recent trades");
      return result.data;
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}
