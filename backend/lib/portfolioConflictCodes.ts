export const PORTFOLIO_CONFLICT_CODES = {
  PRICE_CHANGED: "price_changed",
  HISTORY_CHANGED: "history_changed",
} as const;

export type PortfolioConflictCode =
  (typeof PORTFOLIO_CONFLICT_CODES)[keyof typeof PORTFOLIO_CONFLICT_CODES];
