import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { getPortfolio, getScoreAndHistory, portfolioErrorMessage } from "../../lib/api";
import type { ApiErrorBody, Snapshot } from "../../lib/types";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatShares,
  formatSignedMoney,
  toNumeric,
  trendClass,
} from "../../lib/format";
import { buildPlayerRoute } from "../lib/riotId";
import { StatusMessage } from "../components/StatusMessage";
import { StockChart } from "../components/StockChart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useAuth } from "../state/AuthContext";

class PortfolioRequestError extends Error {
  readonly status: number;

  constructor(status: number, data: ApiErrorBody | null) {
    super(portfolioErrorMessage(status, data));
    this.status = status;
  }
}

class PlayerHistoryRequestError extends Error {}

function parseApiErrorBody(value: unknown): ApiErrorBody | null {
  if (!value || typeof value !== "object") return null;
  if (!("error" in value)) return null;
  return value as ApiErrorBody;
}

function compactHistory(points: Snapshot[]): Snapshot[] {
  return points.slice(-30);
}

export function PortfolioPage() {
  const { user, loading } = useAuth();

  useDocumentTitle("Portfolio — League of Stonks");

  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    enabled: Boolean(user?.emailVerified),
    queryFn: async () => {
      const result = await getPortfolio();
      if (!result.ok || !result.data) {
        throw new PortfolioRequestError(result.status, parseApiErrorBody(result.data));
      }
      return result.data;
    },
  });

  const positions = portfolioQuery.data?.positions ?? [];
  const positionHistoryQueries = useQueries({
    queries: positions.map((position) => ({
      queryKey: ["portfolio", "history", position.gameName, position.tagLine] as const,
      queryFn: async () => {
        const result = await getScoreAndHistory(position.gameName, position.tagLine, 30, { refresh: false });
        if (!result.ok || !result.data) {
          throw new PlayerHistoryRequestError("Could not load player history.");
        }
        return compactHistory(result.data.history);
      },
      staleTime: 60_000,
    })),
  });

  const totalMarketValue = useMemo(() => {
    if (!portfolioQuery.data) return null;
    return portfolioQuery.data.positions.reduce((sum, position) => {
      const value = toNumeric(position.marketValue);
      return value == null ? sum : sum + value;
    }, 0);
  }, [portfolioQuery.data]);

  const totalUnrealizedGain = useMemo(() => {
    if (!portfolioQuery.data) return null;
    return portfolioQuery.data.positions.reduce((sum, position) => {
      const value = toNumeric(position.unrealizedGain);
      return value == null ? sum : sum + value;
    }, 0);
  }, [portfolioQuery.data]);

  if (loading) {
    return <StatusMessage variant="loading" text="Loading your account..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.emailVerified) {
    return <Navigate to="/account" replace />;
  }

  if (portfolioQuery.isPending) {
    return <StatusMessage variant="loading" loadingWidget="lp-bar" text="Loading portfolio..." />;
  }

  if (portfolioQuery.isError) {
    const text =
      portfolioQuery.error instanceof PortfolioRequestError
        ? portfolioQuery.error.message
        : "Could not load portfolio.";
    return <StatusMessage variant="error" text={text} />;
  }

  if (!portfolioQuery.data) {
    return <StatusMessage variant="error" text="Portfolio data is unavailable." />;
  }

  return (
    <section className="portfolio-page">
      {/* ── Summary header ─────────────────────────────── */}
      <header className="portfolio-header">
        <h1 className="portfolio-title">My portfolio</h1>
        <p className="portfolio-subtitle">Track your holdings. Open any position to trade that summoner.</p>
        <div className="portfolio-kpis">
          <div className="portfolio-kpi">
            <span className="portfolio-kpi-label">Available balance</span>
            <span className="portfolio-kpi-value">{formatMoney(portfolioQuery.data.lpBalance) ?? "0.00"} LP</span>
          </div>
          <div className="portfolio-kpi">
            <span className="portfolio-kpi-label">Market value</span>
            <span className="portfolio-kpi-value">{formatMoney(totalMarketValue) ?? "0.00"} LP</span>
          </div>
          <div className="portfolio-kpi">
            <span className="portfolio-kpi-label">Open P/L</span>
            <span className={`portfolio-kpi-value ${trendClass(totalUnrealizedGain ?? 0)}`}>
              {totalUnrealizedGain == null
                ? "n/a"
                : `${formatSignedMoney(totalUnrealizedGain)} LP`}
            </span>
          </div>
        </div>
      </header>

      {/* ── Total portfolio performance placeholder ─────── */}
      <div className="portfolio-perf-panel">
        <div className="portfolio-perf-head">
          <span className="portfolio-perf-title">Portfolio Performance</span>
          <span className="portfolio-perf-tag">Coming soon</span>
        </div>
        <div className="portfolio-perf-placeholder champion-slot-pulse" aria-hidden="true" />
      </div>

      {/* ── Individual positions ────────────────────────── */}
      {positions.length === 0 ? (
        <div className="portfolio-empty">
          <p>You do not own any player shares yet.</p>
          <p>
            Search for a Riot ID above, then use the buy panel on that player page to start your portfolio.
          </p>
        </div>
      ) : (
        <div className="portfolio-positions">
          {positions.map((position, index) => {
            const history = positionHistoryQueries[index]?.data ?? [];
            const historyPending = positionHistoryQueries[index]?.isPending ?? false;
            const gainValue = toNumeric(position.unrealizedGain) ?? 0;
            const gainPct = toNumeric(position.unrealizedGainPct);
            const lastTradeAt = portfolioQuery.data?.trades.find(
              (trade) =>
                trade.gameName.toLowerCase() === position.gameName.toLowerCase() &&
                trade.tagLine.toLowerCase() === position.tagLine.toLowerCase(),
            )?.executedAt;

            return (
              <Link
                key={`${position.gameName.toLowerCase()}#${position.tagLine.toLowerCase()}`}
                className="portfolio-pos"
                to={buildPlayerRoute(position.gameName, position.tagLine)}
              >
                {/* Identity */}
                <div className="portfolio-pos-identity">
                  <h2 className="portfolio-pos-name">{position.gameName}</h2>
                  <p className="portfolio-pos-tag">#{position.tagLine}</p>
                  <p className="portfolio-pos-meta">
                    {lastTradeAt ? `Last trade ${formatDate(lastTradeAt)}` : "No trades yet"}
                  </p>
                </div>

                {/* Stats grid */}
                <div className="portfolio-pos-stats">
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Shares</span>
                    <span className="portfolio-stat-value">{formatShares(position.shares) ?? "0"}</span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Avg cost</span>
                    <span className="portfolio-stat-value">{formatMoney(position.avgCost) ?? "—"} LP</span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Current</span>
                    <span className="portfolio-stat-value">{formatMoney(position.currentPrice) ?? "—"} LP</span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Position value</span>
                    <span className="portfolio-stat-value">{formatMoney(position.marketValue) ?? "—"} LP</span>
                  </div>
                </div>

                {/* P/L */}
                <div className={`portfolio-pos-gain ${trendClass(gainValue)}`}>
                  <span className="portfolio-pos-gain-lp">{formatSignedMoney(gainValue)} LP</span>
                  <span className="portfolio-pos-gain-pct">
                    {gainPct == null ? "—" : formatPercent(gainPct)}
                  </span>
                </div>

                {/* Sparkline */}
                <div className="portfolio-pos-spark">
                  {historyPending ? (
                    <div className="portfolio-spark-skeleton champion-slot-pulse" aria-hidden="true" />
                  ) : history.length > 0 ? (
                    <StockChart points={history} sparkline />
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
