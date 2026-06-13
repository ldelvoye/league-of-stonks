import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  forgotPassword,
  login,
  logout,
  register,
  requestPasswordReset,
} from "../../lib/api";
import { redactEmail } from "../../lib/redact";
import { useAuth } from "../state/AuthContext";
import { useToast } from "../state/ToastContext";
import { authFailureMessage } from "../lib/auth";
import { StatusMessage } from "../components/StatusMessage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

interface AccountPageProps {
  guestMode: "login" | "register";
}

interface InlineMessage {
  variant: "error" | "info";
  text: string;
}

function passwordResetSentMessage(email: string): string {
  return `A password reset link was sent to ${redactEmail(email)}.`;
}

export function AccountPage({ guestMode }: AccountPageProps) {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const { showToast } = useToast();

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [message, setMessage] = useState<InlineMessage | null>(null);

  useDocumentTitle(
    user ? "Account — League of Stonks" : guestMode === "register" ? "Sign up — League of Stonks" : "Log in — League of Stonks",
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setLoginBusy(true);
    const result = await login(loginIdentifier, loginPassword);
    setLoginBusy(false);

    if (!result.ok || !result.data) {
      setMessage({ variant: "error", text: authFailureMessage(result) });
      return;
    }

    setUser(result.data);
    setLoginPassword("");
    void navigate("/");
  }

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setForgotBusy(true);
    const result = await forgotPassword(forgotEmail);
    setForgotBusy(false);

    if (!result.ok) {
      setMessage({ variant: "error", text: authFailureMessage(result) });
      return;
    }

    setShowForgotPassword(false);
    setForgotEmail("");
    setMessage({
      variant: "info",
      text: "If that email exists, a password reset link has been sent.",
    });
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (registerPassword !== registerPasswordConfirm) {
      setMessage({ variant: "error", text: "Passwords do not match." });
      return;
    }

    setMessage(null);
    setRegisterBusy(true);
    const result = await register(registerUsername, registerEmail, registerPassword);
    setRegisterBusy(false);

    if (!result.ok || !result.data) {
      setMessage({ variant: "error", text: authFailureMessage(result) });
      return;
    }

    setUser(result.data);
    setRegisterPassword("");
    setRegisterPasswordConfirm("");
    void navigate("/welcome");
  }

  async function handleRequestPasswordReset(): Promise<void> {
    if (!user) return;
    setMessage(null);
    setPasswordResetBusy(true);
    const result = await requestPasswordReset();
    setPasswordResetBusy(false);

    if (!result.ok) {
      setMessage({ variant: "error", text: authFailureMessage(result) });
      return;
    }

    showToast(passwordResetSentMessage(user.email));
  }

  async function handleLogout(): Promise<void> {
    setMessage(null);
    setLogoutBusy(true);
    await logout();
    setLogoutBusy(false);
    setUser(null);
    void navigate("/");
  }

  if (loading) {
    return <StatusMessage variant="loading" text="Loading your account..." />;
  }

  return (
    <>
      {message ? (
        <StatusMessage
          variant={message.variant === "error" ? "error" : "info"}
          text={message.text}
        />
      ) : null}

      <section className={`auth-card auth-card--wide ${user ? "account-shell" : "auth-shell"}`}>
        {user ? (
          <div>
            <h1 className="auth-title">My account</h1>
            <p className="account-username-display">Signed in as {user.username}</p>

            {!user.emailVerified ? (
              <div className="account-unverified-prompt">
                <p>Your account email is not verified yet.</p>
                <Link to="/welcome">Go to verification page</Link>
              </div>
            ) : null}

            <section className="account-category">
              <h2 className="account-category-title">Edit profile</h2>
              <div className="account-action-list">
                <Link className="btn btn-ghost account-action-btn" to="/account/username">
                  Edit username
                </Link>
                <Link className="btn btn-ghost account-action-btn" to="/account/email">
                  Edit email
                </Link>
                <button
                  className="btn btn-ghost account-action-btn"
                  type="button"
                  onClick={() => void handleRequestPasswordReset()}
                  disabled={passwordResetBusy}
                >
                  {passwordResetBusy ? "Sending…" : "Edit password"}
                </button>
              </div>
            </section>

            <button
              className="btn btn-ghost account-logout"
              type="button"
              onClick={() => void handleLogout()}
              disabled={logoutBusy}
            >
              {logoutBusy ? "Logging out…" : "Log out"}
            </button>
          </div>
        ) : guestMode === "login" ? (
          <div>
            <h1 className="auth-title">Log in</h1>
            <p className="auth-sub">Sign in to your League of Stonks account.</p>
            <form className="auth-form" autoComplete="on" onSubmit={(event) => void handleLogin(event)}>
              <label className="field">
                <span className="field-label">Email or username</span>
                <input
                  className="field-input"
                  type="text"
                  name="identifier"
                  autoComplete="username"
                  required
                  value={loginIdentifier}
                  onChange={(event) => setLoginIdentifier(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <input
                  className="field-input"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  minLength={8}
                  required
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
              </label>
              <button className="btn btn-primary auth-submit" type="submit" disabled={loginBusy}>
                {loginBusy ? "Logging in…" : "Log in"}
              </button>
            </form>

            {!showForgotPassword ? (
              <button
                className="auth-link-btn"
                type="button"
                onClick={() => {
                  setMessage(null);
                  setShowForgotPassword(true);
                }}
              >
                Forgot password?
              </button>
            ) : null}

            {showForgotPassword ? (
              <form
                className="auth-form auth-inline-form"
                onSubmit={(event) => void handleForgotPassword(event)}
              >
                <label className="field">
                  <span className="field-label">Account email</span>
                  <input
                    className="field-input"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={forgotEmail}
                    onChange={(event) => setForgotEmail(event.target.value)}
                  />
                </label>
                <div className="auth-inline-actions">
                  <button className="btn btn-primary" type="submit" disabled={forgotBusy}>
                    {forgotBusy ? "Sending…" : "Send reset link"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={forgotBusy}
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotEmail("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            <p className="auth-switch">
              No account?{" "}
              <Link to="/register" onClick={() => setMessage(null)}>
                Create one
              </Link>
            </p>
          </div>
        ) : (
          <div>
            <h1 className="auth-title">Create account</h1>
            <p className="auth-sub">Track player share prices in LP and build your portfolio.</p>
            <form className="auth-form" autoComplete="on" onSubmit={(event) => void handleRegister(event)}>
              <label className="field">
                <span className="field-label">Username</span>
                <input
                  className="field-input"
                  type="text"
                  name="username"
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9_]+"
                  required
                  value={registerUsername}
                  onChange={(event) => setRegisterUsername(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Email</span>
                <input
                  className="field-input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={registerEmail}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <input
                  className="field-input"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Confirm password</span>
                <input
                  className="field-input"
                  type="password"
                  name="passwordConfirm"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={registerPasswordConfirm}
                  onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
                />
                {registerPasswordConfirm ? (
                  <p
                    className={`field-feedback ${
                      registerPassword === registerPasswordConfirm ? "is-match" : "is-mismatch"
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {registerPassword === registerPasswordConfirm
                      ? "Passwords match"
                      : "Passwords do not match"}
                  </p>
                ) : null}
              </label>
              <p className="field-hint">
                Username: 3-32 letters, numbers, or underscores. Password: at least 8 characters.
              </p>
              <button className="btn btn-primary auth-submit" type="submit" disabled={registerBusy}>
                {registerBusy ? "Creating account…" : "Create account"}
              </button>
            </form>

            <p className="auth-switch">
              Already have an account?{" "}
              <Link to="/login" onClick={() => setMessage(null)}>
                Log in
              </Link>
            </p>
          </div>
        )}
      </section>
    </>
  );
}
