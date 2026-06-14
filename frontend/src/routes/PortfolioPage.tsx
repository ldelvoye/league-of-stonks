import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { usePortfolioQuery, PortfolioRequestError } from "../queries/portfolio.js";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatShares,
  formatSignedMoney,
  toNumeric,
  trendClass,
} from "../../lib/format.js";
import { buildPlayerRoute } from "../lib/riotId.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { StockChart } from "../components/StockChart.js";
import { useDocumentTitle } from "../hooks/useDocumentTitle.js";
import { useAuth } from "../state/AuthContext.js";

export function PortfolioPage() {
  const { user, loading } = useAuth();

  useDocumentTitle("Portfolio — League of Stonks");

  const portfolioQuery = usePortfolioQuery({ enabled: Boolean(user?.emailVerified) });

  const positions = portfolioQuery.data?.positions ?? [];

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
      portfolioQuery.error instanceof PortfolioRequestError ||
      portfolioQuery.error instanceof Error
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
        <p className="portfolio-subtitle">
          Track your holdings. Open any position to trade that summoner.
        </p>
        <div className="portfolio-kpis">
          <div className="portfolio-kpi">
            <span className="portfolio-kpi-label">Available balance</span>
            <span className="portfolio-kpi-value">
              {formatMoney(portfolioQuery.data.lpBalance) ?? "0.00"} LP
            </span>
          </div>
          <div className="portfolio-kpi">
            <span className="portfolio-kpi-label">Market value</span>
            <span className="portfolio-kpi-value">
              {formatMoney(totalMarketValue) ?? "0.00"} LP
            </span>
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
            Search for a Riot ID above, then use the buy panel on that player page to start your
            portfolio.
          </p>
        </div>
      ) : (
        <div className="portfolio-positions">
          {positions.map((position) => {
            const history = position.sparklineHistory;
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
                    <span className="portfolio-stat-value">
                      {formatShares(position.shares) ?? "0"}
                    </span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Avg cost</span>
                    <span className="portfolio-stat-value">
                      {formatMoney(position.avgCost) ?? "—"} LP
                    </span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Current</span>
                    <span className="portfolio-stat-value">
                      {formatMoney(position.currentPrice) ?? "—"} LP
                    </span>
                  </div>
                  <div className="portfolio-stat">
                    <span className="portfolio-stat-label">Position value</span>
                    <span className="portfolio-stat-value">
                      {formatMoney(position.marketValue) ?? "—"} LP
                    </span>
                  </div>
                </div>

                {/* P/L */}
                <div className={`portfolio-pos-gain ${trendClass(gainValue)}`}>
                  <span className="portfolio-pos-gain-lp">
                    {formatSignedMoney(gainValue)} LP
                  </span>
                  <span className="portfolio-pos-gain-pct">
                    {gainPct == null ? "—" : formatPercent(gainPct)}
                  </span>
                </div>

                {/* Sparkline */}
                <div className="portfolio-pos-spark">
                  {history.length > 0 ? <StockChart points={history} sparkline /> : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
