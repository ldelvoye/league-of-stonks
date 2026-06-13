import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmail } from "../../lib/api";
import { useAuth } from "../state/AuthContext";
import { authFailureMessage } from "../lib/auth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type VerifyStatus = "loading" | "success" | "error";

interface VerifyState {
  status: VerifyStatus;
  message: string;
}

function statusClass(status: VerifyStatus): string {
  if (status === "loading") return "auth-status is-loading";
  if (status === "error") return "auth-status is-error";
  return "auth-status is-success";
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const { refreshSession } = useAuth();
  const [state, setState] = useState<VerifyState>({
    status: "loading",
    message: "Verifying your email...",
  });

  useDocumentTitle("Verify email — League of Stonks");

  const token = searchParams.get("token")?.trim() ?? "";

  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: "Verification token is required." });
      return;
    }

    let cancelled = false;

    async function runVerification(): Promise<void> {
      setState({ status: "loading", message: "Verifying your email..." });
      const result = await verifyEmail(token);
      if (cancelled) return;

      if (!result.ok) {
        setState({ status: "error", message: authFailureMessage(result) });
        return;
      }

      await refreshSession();
      if (cancelled) return;
      setState({ status: "success", message: "Email verified. You can return home." });
    }

    void runVerification();
    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  return (
    <section className="auth-card">
      <h1 className="auth-title">Verify email</h1>
      <div className={statusClass(state.status)} role="status" aria-live="polite">
        {state.status === "loading" ? (
          <>
            <span className="spinner" />
            <span>{state.message}</span>
          </>
        ) : (
          state.message
        )}
      </div>
      <p className="auth-switch">
        <Link to="/">Back to home</Link>
      </p>
    </section>
  );
}
