import { useState, useCallback } from "react";
import { usePlayerQuery, useRefreshPlayer } from "../queries/player.js";

const MIN_REFRESH_VISUAL_MS = 700;

/**
 * Combines the player cache query with the Riot-refresh flow and a minimum
 * visual busy duration so the spinner does not flash instantly on fast refreshes.
 */
export function usePlayerData(gameName: string, tagLine: string) {
  const [isRefreshUiBusy, setIsRefreshUiBusy] = useState(false);
  const playerQuery = usePlayerQuery(gameName, tagLine);
  const refreshPlayer = useRefreshPlayer(gameName, tagLine);

  const handleRefresh = useCallback(async () => {
    if (isRefreshUiBusy || playerQuery.isRefetching) return;
    setIsRefreshUiBusy(true);
    const startedAt = Date.now();
    try {
      await refreshPlayer();
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_REFRESH_VISUAL_MS - elapsed);
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
      setIsRefreshUiBusy(false);
    }
  }, [isRefreshUiBusy, playerQuery.isRefetching, refreshPlayer]);

  return {
    playerQuery,
    handleRefresh,
    isRefreshBusy: isRefreshUiBusy || playerQuery.isRefetching,
  };
}
