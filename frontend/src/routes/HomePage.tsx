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
      <h1 className="welcome-title">Track the rise &amp; fall of summoner rank</h1>
      <p className="welcome-sub">
        Look up any player by their Riot ID to see their price-per-share history in LP.
      </p>
      <p className="welcome-hint">
        Early-stage beta: only players on the NA server are currently supported.
      </p>
      <div className="welcome-actions">
        <Link className={portfolioCtaClass} to={portfolioCtaTarget}>
          {portfolioCtaLabel}
        </Link>
      </div>
    </section>
  );
}
