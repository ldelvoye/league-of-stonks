import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resetPassword } from "../../lib/api";
import { useAuth } from "../state/AuthContext";
import { authFailureMessage } from "../lib/auth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type ResetStatus = "loading" | "success" | "error";

interface ResetState {
  status: ResetStatus;
  message: string;
}

function statusClass(status: ResetStatus): string {
  if (status === "loading") return "auth-status is-loading";
  if (status === "error") return "auth-status is-error";
  return "auth-status is-success";
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const { setUser } = useAuth();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ResetState | null>(null);

  useDocumentTitle("Reset password — League of Stonks");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      setStatus({ status: "error", message: "Reset token is required." });
      return;
    }
    if (password !== passwordConfirm) {
      setStatus({ status: "error", message: "Passwords do not match." });
      return;
    }

    setBusy(true);
    setStatus({ status: "loading", message: "Updating your password..." });
    const result = await resetPassword(token, password);
    setBusy(false);

    if (!result.ok) {
      setStatus({ status: "error", message: authFailureMessage(result) });
      return;
    }

    setUser(null);
    setPassword("");
    setPasswordConfirm("");
    setStatus({ status: "success", message: "Password updated. You can now log in." });
  }

  return (
    <section className="auth-card">
      <h1 className="auth-title">Reset password</h1>
      <p className="auth-sub">Choose a new password for your account.</p>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span className="field-label">New password</span>
          <input
            className="field-input"
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Confirm new password</span>
          <input
            className="field-input"
            type="password"
            name="passwordConfirm"
            autoComplete="new-password"
            minLength={8}
            required
            disabled={busy}
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
          />
          {passwordConfirm ? (
            <p
              className={`field-feedback ${password === passwordConfirm ? "is-match" : "is-mismatch"}`}
              role="status"
              aria-live="polite"
            >
              {password === passwordConfirm ? "Passwords match" : "Passwords do not match"}
            </p>
          ) : null}
        </label>
        <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>

      {status ? (
        <div className={statusClass(status.status)} role="status" aria-live="polite">
          {status.status === "loading" ? (
            <>
              <span className="spinner" />
              <span>{status.message}</span>
            </>
          ) : (
            status.message
          )}
        </div>
      ) : null}

      <p className="auth-switch">
        <Link to="/login">Back to login</Link>
      </p>
    </section>
  );
}
