import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle.js";
import { useAuth } from "../state/AuthContext.js";
import { useMarketStats, useTopPerformers, useRecentTrades } from "../queries/market.js";
import { formatLpInt, formatShares, formatDate } from "../../lib/format.js";
import { buildPlayerRoute } from "../lib/riotId.js";

export function HomePage() {
  const { user } = useAuth();
  useDocumentTitle("League of Stonks");
  const portfolioCtaTarget = !user ? "/login" : user.emailVerified ? "/portfolio" : "/account";
  const portfolioCtaClass = !user || user.emailVerified ? "btn btn-primary" : "btn btn-warning";
  const portfolioCtaLabel = !user
    ? "Sign in to view portfolio"
    : user.emailVerified
      ? "Open my portfolio"
      : "Verify email to unlock portfolio";

  const statsQuery = useMarketStats();
  const topQuery = useTopPerformers({ limit: 10, windowDays: 30 });
  const tradesQuery = useRecentTrades({ limit: 10 });

  return (
    <section className="welcome">
      <div className="welcome-hero-panel">
        <p className="welcome-kicker">Solo Queue Exchange</p>
        <h1 className="welcome-title">Trade the ranked grind of your favorite frauds</h1>
        <p className="welcome-sub">
          Every LP gain and int-fest is a price movement. Back the believers, short the inters, and
          build a portfolio of the solo queue degenerates you follow anyway.
        </p>
        <p className="welcome-hint">
          Currently tracking NA ranked. More regions incoming — assuming Riot doesn't patch out the
          suffering.
        </p>
        <div className="welcome-actions">
          <Link className={portfolioCtaClass} to={portfolioCtaTarget}>
            {portfolioCtaLabel}
          </Link>
        </div>
      </div>

      <div className="home-grid">
        {/* ── Market Pulse ─────────────────────────────── */}
        <section className="home-panel">
          <header className="home-panel-head">
            <h2 className="home-panel-title">Market Pulse</h2>
          </header>
          {statsQuery.isPending ? (
            <div className="home-stats-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="home-stat-cell champion-slot-pulse" aria-hidden="true" />
              ))}
            </div>
          ) : statsQuery.isError || !statsQuery.data ? (
            <p className="home-panel-empty">Market data unavailable.</p>
          ) : (
            <div className="home-stats-grid">
              <div className="home-stat-cell">
                <span className="home-stat-value">
                  {statsQuery.data.trackedSummoners.toLocaleString()}
                </span>
                <span className="home-stat-label">Summoners tracked</span>
              </div>
              <div className="home-stat-cell">
                <span className="home-stat-value">
                  {statsQuery.data.totalTrades.toLocaleString()}
                </span>
                <span className="home-stat-label">All-time trades</span>
              </div>
              <div className="home-stat-cell">
                <span className="home-stat-value">
                  {formatLpInt(statsQuery.data.volume24h) ?? "0"}
                </span>
                <span className="home-stat-label">LP volume (24 h)</span>
              </div>
            </div>
          )}
        </section>

        {/* ── Top Performers ───────────────────────────── */}
        <section className="home-panel">
          <header className="home-panel-head">
            <h2 className="home-panel-title">Top Performers</h2>
            <span className="home-panel-tag">30 days</span>
          </header>
          {topQuery.isPending ? (
            <div className="home-placeholder-list" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="home-placeholder-row champion-slot-pulse" />
              ))}
            </div>
          ) : topQuery.isError || !topQuery.data ? (
            <p className="home-panel-empty">Leaderboard unavailable.</p>
          ) : topQuery.data.length === 0 ? (
            <p className="home-panel-empty">No ranked data yet.</p>
          ) : (
            <ol className="home-leaderboard">
              {topQuery.data.map((performer, index) => (
                <li
                  key={`${performer.gameName}#${performer.tagLine}`}
                  className="home-lb-row"
                >
                  <span className="home-lb-rank">{index + 1}</span>
                  <Link
                    className="home-lb-player"
                    to={buildPlayerRoute(performer.gameName, performer.tagLine)}
                  >
                    <span className="home-lb-name">{performer.gameName}</span>
                    <span className="home-lb-tag">#{performer.tagLine}</span>
                  </Link>
                  <span className={`home-lb-delta change-up`}>
                    +{formatLpInt(performer.deltaLp) ?? "0"} LP
                    {performer.deltaPct != null ? (
                      <span className="home-lb-pct"> (+{performer.deltaPct.toFixed(1)}%)</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ── Recent Trades ────────────────────────────── */}
        <section className="home-panel">
          <header className="home-panel-head">
            <h2 className="home-panel-title">Recent Trades</h2>
          </header>
          {tradesQuery.isPending ? (
            <div className="home-placeholder-list" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="home-placeholder-row champion-slot-pulse" />
              ))}
            </div>
          ) : tradesQuery.isError || !tradesQuery.data ? (
            <p className="home-panel-empty">Trade feed unavailable.</p>
          ) : tradesQuery.data.length === 0 ? (
            <p className="home-panel-empty">No trades yet. Be the first.</p>
          ) : (
            <ol className="home-trade-feed">
              {tradesQuery.data.map((trade) => (
                <li key={trade.tradeId} className="home-trade-row">
                  <span className={`home-trade-side home-trade-side--${trade.side}`}>
                    {trade.side.toUpperCase()}
                  </span>
                  <Link
                    className="home-trade-player"
                    to={buildPlayerRoute(trade.gameName, trade.tagLine)}
                  >
                    {trade.gameName}
                    <span className="home-trade-tag">#{trade.tagLine}</span>
                  </Link>
                  <span className="home-trade-meta">
                    {formatShares(trade.shares) ?? "?"} sh @{" "}
                    {formatLpInt(trade.pricePerShare) ?? "?"} LP
                  </span>
                  <span className="home-trade-time">{formatDate(trade.executedAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
