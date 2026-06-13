import { FormEvent, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import { useToast } from "./state/ToastContext";
import { buildPlayerRoute, parseRiotId } from "./lib/riotId";
import { ToastPopup } from "./components/ToastPopup";
import { StatusMessage } from "./components/StatusMessage";

const HomePage = lazy(async () => {
  const module = await import("./routes/HomePage");
  return { default: module.HomePage };
});

const PlayerPage = lazy(async () => {
  const module = await import("./routes/PlayerPage");
  return { default: module.PlayerPage };
});

const PortfolioPage = lazy(async () => {
  const module = await import("./routes/PortfolioPage");
  return { default: module.PortfolioPage };
});

const AccountPage = lazy(async () => {
  const module = await import("./routes/AccountPage");
  return { default: module.AccountPage };
});

const AccountUsernamePage = lazy(async () => {
  const module = await import("./routes/AccountUsernamePage");
  return { default: module.AccountUsernamePage };
});

const AccountEmailPage = lazy(async () => {
  const module = await import("./routes/AccountEmailPage");
  return { default: module.AccountEmailPage };
});

const WelcomePage = lazy(async () => {
  const module = await import("./routes/WelcomePage");
  return { default: module.WelcomePage };
});

const VerifyEmailPage = lazy(async () => {
  const module = await import("./routes/VerifyEmailPage");
  return { default: module.VerifyEmailPage };
});

const ResetPasswordPage = lazy(async () => {
  const module = await import("./routes/ResetPasswordPage");
  return { default: module.ResetPasswordPage };
});

function usernameInitials(username: string): string {
  if (username.length >= 2) return username.slice(0, 2);
  return username.slice(0, 1) || "?";
}

function playerSearchValue(pathname: string): string | null {
  const match = pathname.match(/^\/player\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return `${decodeURIComponent(match[1])}#${decodeURIComponent(match[2])}`;
  } catch {
    return null;
  }
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { showToast } = useToast();

  const initialSearchValue = useMemo(() => playerSearchValue(location.pathname) ?? "", []);
  const [searchValue, setSearchValue] = useState(initialSearchValue);

  useEffect(() => {
    if (!location.hash.startsWith("#/")) return;
    navigate(location.hash.slice(1), { replace: true });
  }, [location.hash, navigate]);

  useEffect(() => {
    const next = playerSearchValue(location.pathname);
    if (next !== null) {
      setSearchValue(next);
      return;
    }
    if (location.pathname === "/") {
      setSearchValue("");
    }
  }, [location.pathname]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = parseRiotId(searchValue);
    if (!parsed) {
      showToast("Enter a Riot ID like Faker#KR1 (GameName#TagLine).");
      return;
    }
    navigate(buildPlayerRoute(parsed.gameName, parsed.tagLine));
  }

  return (
    <div className="app">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="League of Stonks home">
          <span className="brand-mark" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 17l5-5 4 4 8-8" />
              <path d="M16 8h4v4" />
            </svg>
          </span>
          <span className="brand-text">
            League of <span className="brand-accent">Stonks</span>
          </span>
        </Link>

        <form className="search" role="search" autoComplete="off" onSubmit={handleSearchSubmit}>
          <input
            className="search-input"
            type="text"
            name="riotId"
            placeholder="Search a Riot ID — e.g. Faker#KR1"
            aria-label="Riot ID"
            spellCheck={false}
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>

        <Link
          className={`auth-avatar ${user ? "is-signed-in" : ""}`}
          to="/account"
          aria-label={user ? `Account: ${user.username}` : "Account"}
        >
          <svg
            className="auth-avatar-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M5 20c0-4 3.5-6 7-6s7 2 7 6" />
          </svg>
          <span className="auth-avatar-initials">{user ? usernameInitials(user.username) : ""}</span>
        </Link>
      </header>

      <main className="content">
        <Suspense fallback={<StatusMessage variant="loading" text="Loading page..." />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/player/:gameName/:tagLine" element={<PlayerPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/account" element={<AccountPage guestMode="login" />} />
            <Route path="/login" element={<AccountPage guestMode="login" />} />
            <Route path="/register" element={<AccountPage guestMode="register" />} />
            <Route path="/account/username" element={<AccountUsernamePage />} />
            <Route path="/account/email" element={<AccountEmailPage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      <footer className="site-footer">
        <span>League of Stonks</span>
      </footer>

      <ToastPopup />
    </div>
  );
}
