import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { getProfileChangeStatus, updateAccountProfile } from "../../lib/api";
import { useAuth } from "../state/AuthContext";
import { useToast } from "../state/ToastContext";
import { authFailureMessage } from "../lib/auth";
import { StatusMessage } from "../components/StatusMessage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const USERNAME_WARNING_DEFAULT = "Username can only be changed once every 24 hours.";

export function AccountUsernamePage() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const { showToast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [warning, setWarning] = useState(USERNAME_WARNING_DEFAULT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useDocumentTitle("Change username — League of Stonks");

  useEffect(() => {
    if (!user) return;
    setUsername(user.username);
  }, [user]);

  const syncStatus = useCallback(async (): Promise<void> => {
    const result = await getProfileChangeStatus();
    if (!result.ok || !result.data) {
      setLocked(false);
      setWarning(USERNAME_WARNING_DEFAULT);
      return;
    }
    const status = result.data.username;
    setLocked(!status.allowed);
    setWarning(status.message ?? USERNAME_WARNING_DEFAULT);
  }, []);

  useEffect(() => {
    if (!user) return;
    void syncStatus();
  }, [syncStatus, user?.userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) return;

    const nextUsername = username.trim();
    if (!nextUsername || nextUsername === user.username) {
      showToast("New username cannot be the same as the current username.");
      return;
    }

    setErrorMessage(null);
    setBusy(true);
    const result = await updateAccountProfile(nextUsername, user.email, password);
    setBusy(false);

    if (!result.ok || !result.data) {
      const message = authFailureMessage(result);
      if (result.status === 429) showToast(message);
      else setErrorMessage(message);
      await syncStatus();
      return;
    }

    setUser(result.data);
    setPassword("");
    showToast("Username updated.");
    void navigate("/account");
  }

  if (loading) {
    return <StatusMessage variant="loading" text="Loading your account..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      {errorMessage ? <StatusMessage variant="error" text={errorMessage} /> : null}
      <section className="auth-card auth-card--wide">
        <p className="auth-back">
          <Link to="/account">&larr; Account</Link>
        </p>
        <h1 className="auth-title">Change username</h1>
        <p className="auth-sub">Choose a new username for your account.</p>
        <p className={`account-change-warning ${locked ? "is-locked" : ""}`}>{warning}</p>
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span className="field-label">New username</span>
            <input
              className="field-input"
              type="text"
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              required
              disabled={busy || locked}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Current password</span>
            <input
              className="field-input"
              type="password"
              name="password"
              autoComplete="current-password"
              minLength={8}
              required
              disabled={busy || locked}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p className="field-hint">3–32 characters: letters, numbers, or underscores.</p>
          <button className="btn btn-primary auth-submit" type="submit" disabled={busy || locked}>
            {busy ? "Saving…" : "Save username"}
          </button>
        </form>
      </section>
    </>
  );
}
