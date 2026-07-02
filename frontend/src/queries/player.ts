import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getScoreAndHistory, PLAYER_HISTORY_SEASON_S16, scoreErrorMessage } from "../../lib/api.js";
import { queryKeys } from "./keys.js";

const SEASON_HISTORY_LIMIT = 5000;

export class PlayerRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(scoreErrorMessage(status));
    this.name = "PlayerRequestError";
    this.status = status;
  }
}

export function usePlayerQuery(gameName: string, tagLine: string) {
  return useQuery({
    queryKey: queryKeys.player.detail(gameName, tagLine),
    enabled: Boolean(gameName && tagLine),
    queryFn: async () => {
      const result = await getScoreAndHistory(gameName, tagLine, SEASON_HISTORY_LIMIT, {
        refresh: false,
        season: PLAYER_HISTORY_SEASON_S16,
      });
      if (!result.ok || !result.data) throw new PlayerRequestError(result.status);
      return result.data;
    },
  });
}

/**
 * Returns a stable callback that triggers a Riot-backed refresh for the given
 * player and writes the result into the React Query cache.
 */
export function useRefreshPlayer(gameName: string, tagLine: string) {
  const queryClient = useQueryClient();

  return useCallback(async (): Promise<void> => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.player.detail(gameName, tagLine),
      queryFn: async () => {
        const result = await getScoreAndHistory(gameName, tagLine, SEASON_HISTORY_LIMIT, {
          refresh: true,
          season: PLAYER_HISTORY_SEASON_S16,
        });
        if (!result.ok || !result.data) throw new PlayerRequestError(result.status);
        return result.data;
      },
    });
  }, [gameName, tagLine, queryClient]);
}
