import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { executeTrade, portfolioErrorMessage } from "../../../../lib/api.js";
import type { AuthUser, PortfolioTradeSide } from "../../../../lib/types.js";
import { parseApiErrorBody } from "../../../queries/portfolio.js";
import { queryKeys } from "../../../queries/keys.js";
import { formatShares } from "../../../../lib/format.js";
import { useToast } from "../../../state/ToastContext.js";

interface UseExecuteTradeOptions {
  gameName: string;
  tagLine: string;
  user: AuthUser | null;
}

/**
 * Handles the full trade execution lifecycle: auth checks, API call, cache
 * update, invalidation, and success/error toasts.
 */
export function useExecuteTrade({ gameName, tagLine, user }: UseExecuteTradeOptions) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [tradeBusySide, setTradeBusySide] = useState<PortfolioTradeSide | null>(null);
  const playerQueryKey = queryKeys.player.detail(gameName, tagLine);

  const handleTrade = useCallback(
    async (side: PortfolioTradeSide, shares: string): Promise<void> => {
      if (!user) {
        void navigate("/login");
        return;
      }
      if (!user.emailVerified) {
        showToast("Verify your email to unlock portfolio trading.");
        void navigate("/account");
        return;
      }

      setTradeBusySide(side);
      const result = await executeTrade(gameName, tagLine, side, shares);
      setTradeBusySide(null);

      if (!result.ok || !result.data) {
        const message = portfolioErrorMessage(result.status, parseApiErrorBody(result.data));
        showToast(message);
        if (result.status === 401) {
          void navigate("/login");
        }
        return;
      }

      queryClient.setQueryData(queryKeys.portfolio.detail(), result.data.portfolio);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.detail() }),
        queryClient.invalidateQueries({ queryKey: playerQueryKey }),
      ]);

      const shareText = formatShares(result.data.trade.shares) ?? result.data.trade.shares;
      showToast(
        side === "buy"
          ? `Bought ${shareText} shares of ${result.data.trade.gameName}#${result.data.trade.tagLine}.`
          : `Sold ${shareText} shares of ${result.data.trade.gameName}#${result.data.trade.tagLine}.`,
      );
    },
    [gameName, tagLine, user, playerQueryKey, navigate, showToast, queryClient],
  );

  return { handleTrade, tradeBusySide };
}
