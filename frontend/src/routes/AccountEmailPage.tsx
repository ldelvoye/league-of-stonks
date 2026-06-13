import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { getProfileChangeStatus, updateAccountProfile } from "../../lib/api";
import { useAuth } from "../state/AuthContext";
import { useToast } from "../state/ToastContext";
import { authFailureMessage, normalizeEmailForCompare } from "../lib/auth";
import { StatusMessage } from "../components/StatusMessage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const EMAIL_WARNING_DEFAULT = "Email can only be changed once every 24 hours.";

export function AccountEmailPage() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [warning, setWarning] = useState(EMAIL_WARNING_DEFAULT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useDocumentTitle("Change email — League of Stonks");

  useEffect(() => {
    if (!user) return;
    setEmail(user.email);
  }, [user]);

  const syncStatus = useCallback(async (): Promise<void> => {
    const result = await getProfileChangeStatus();
    if (!result.ok || !result.data) {
      setLocked(false);
      setWarning(EMAIL_WARNING_DEFAULT);
      return;
    }
    const status = result.data.email;
    setLocked(!status.allowed);
    setWarning(status.message ?? EMAIL_WARNING_DEFAULT);
  }, []);

  useEffect(() => {
    if (!user) return;
    void syncStatus();
  }, [syncStatus, user?.userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) return;

    const nextEmail = normalizeEmailForCompare(email);
    if (!nextEmail || nextEmail === normalizeEmailForCompare(user.email)) {
      showToast("New email cannot be the same as the current email.");
      return;
    }

    setErrorMessage(null);
    setBusy(true);
    const result = await updateAccountProfile(user.username, nextEmail, password);
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
    showToast("Verification email sent. Your email updates after you verify it.");
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
        <h1 className="auth-title">Change email</h1>
        <p className="auth-sub">Enter a new email address. It updates only after you verify it.</p>
        <p className={`account-change-warning ${locked ? "is-locked" : ""}`}>{warning}</p>
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span className="field-label">New email</span>
            <input
              className="field-input"
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={busy || locked}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
          <button className="btn btn-primary auth-submit" type="submit" disabled={busy || locked}>
            {busy ? "Saving…" : "Save email"}
          </button>
        </form>
      </section>
    </>
  );
}
