import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function HomePage() {
  useDocumentTitle("League of Stonks");

  return (
    <section className="welcome">
      <h1 className="welcome-title">Track the rise &amp; fall of summoner rank</h1>
      <p className="welcome-sub">
        Look up any player by their Riot ID to see their ranked score history.
      </p>
      <p className="welcome-hint">
        Early-stage beta: only players on the NA server are currently supported.
      </p>
      <p className="welcome-hint">
        Enter a Riot ID in the format <code>GameName#TagLine</code>.
      </p>
    </section>
  );
}
