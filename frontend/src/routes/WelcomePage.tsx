import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { resendVerification } from "../../lib/api";
import { redactEmail } from "../../lib/redact";
import { useAuth } from "../state/AuthContext";
import { useToast } from "../state/ToastContext";
import { authFailureMessage } from "../lib/auth";
import { StatusMessage } from "../components/StatusMessage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function WelcomePage() {
  const { user, loading } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useDocumentTitle("Welcome — League of Stonks");

  async function handleResend(): Promise<void> {
    setErrorMessage(null);
    setBusy(true);
    const result = await resendVerification();
    setBusy(false);
    if (!result.ok) {
      setErrorMessage(authFailureMessage(result));
      return;
    }
    showToast("New verification email sent.");
  }

  if (loading) {
    return <StatusMessage variant="loading" text="Loading your account..." />;
  }

  if (!user) {
    return <Navigate to="/account" replace />;
  }

  if (user.emailVerified) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      {errorMessage ? <StatusMessage variant="error" text={errorMessage} /> : null}
      <section className="auth-card welcome-verify-card">
        <h1 className="auth-title">Welcome to League of Stonks</h1>
        <p className="auth-sub">
          We sent a verification email to{" "}
          <span className="welcome-verify-email">{redactEmail(user.email)}</span>. Open the link in
          that message to activate your account.
        </p>
        <p className="welcome-verify-hint">Didn&apos;t get it? Check spam, or request a new one below.</p>
        <button
          className="btn btn-primary auth-submit"
          type="button"
          onClick={() => void handleResend()}
          disabled={busy}
        >
          {busy ? "Sending…" : "Resend verification email"}
        </button>
        <p className="auth-switch">
          <Link to="/">Continue to home</Link>
        </p>
      </section>
    </>
  );
}
