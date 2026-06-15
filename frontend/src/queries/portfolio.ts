import { useQuery } from "@tanstack/react-query";
import { getPortfolio, portfolioErrorMessage } from "../../lib/api.js";
import { SessionExpiredError } from "../../lib/api.js";
import type { ApiErrorBody } from "../../lib/types.js";
import { queryKeys } from "./keys.js";

export class PortfolioRequestError extends Error {
  readonly status: number;

  constructor(status: number, data: ApiErrorBody | null) {
    super(portfolioErrorMessage(status, data));
    this.name = "PortfolioRequestError";
    this.status = status;
  }
}

export function parseApiErrorBody(value: unknown): ApiErrorBody | null {
  if (!value || typeof value !== "object") return null;
  if (!("error" in value) && !("code" in value)) return null;
  return value as ApiErrorBody;
}

export function usePortfolioQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.portfolio.detail(),
    enabled,
    queryFn: async () => {
      const result = await getPortfolio();
      if (!result.ok || !result.data) {
        // Let the global QueryCache error handler clear auth state on 401.
        if (result.status === 401) throw new SessionExpiredError();
        throw new PortfolioRequestError(result.status, parseApiErrorBody(result.data));
      }
      return result.data;
    },
  });
}
