import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useAuth } from "../state/AuthContext";

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

  return (
    <section className="welcome">
      <div className="welcome-hero-panel">
        <p className="welcome-kicker">Solo Queue Exchange</p>
        <h1 className="welcome-title">Trade the ranked grind of your favorite frauds</h1>
        <p className="welcome-sub">
          Every LP gain and int-fest is a price movement. Back the believers, short the inters, and build a
          portfolio of the solo queue degenerates you follow anyway.
        </p>
        <p className="welcome-hint">
          Currently tracking NA ranked. More regions incoming — assuming Riot doesn't patch out the suffering.
        </p>
        <div className="welcome-actions">
          <Link className={portfolioCtaClass} to={portfolioCtaTarget}>
            {portfolioCtaLabel}
          </Link>
        </div>
      </div>

      <div className="home-grid">
        <section className="home-panel">
          <header className="home-panel-head">
            <h2 className="home-panel-title">Market Pulse</h2>
            <span className="home-panel-tag">Coming soon</span>
          </header>
          <p className="home-panel-copy">
            This strip will surface major LP movers, macro volatility, and matchday sentiment widgets.
          </p>
        </section>

        <section className="home-panel">
          <header className="home-panel-head">
            <h2 className="home-panel-title">Top Performers</h2>
            <span className="home-panel-tag">Leaderboard scaffold</span>
          </header>
          <div className="home-placeholder-list" aria-hidden="true">
            <div className="home-placeholder-row champion-slot-pulse" />
            <div className="home-placeholder-row champion-slot-pulse" />
            <div className="home-placeholder-row champion-slot-pulse" />
          </div>
        </section>

        <section className="home-panel">
          <header className="home-panel-head">
            <h2 className="home-panel-title">Recent Trades</h2>
            <span className="home-panel-tag">Activity scaffold</span>
          </header>
          <div className="home-placeholder-list" aria-hidden="true">
            <div className="home-placeholder-row champion-slot-pulse" />
            <div className="home-placeholder-row champion-slot-pulse" />
            <div className="home-placeholder-row champion-slot-pulse" />
            <div className="home-placeholder-row champion-slot-pulse" />
          </div>
        </section>
      </div>
    </section>
  );
}
