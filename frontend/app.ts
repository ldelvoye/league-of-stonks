import {
  authErrorMessage,
  forgotPassword,
  getMe,
  getProfileChangeStatus,
  getScoreAndHistory,
  login,
  logout,
  requestPasswordReset,
  register,
  resetPassword,
  resendVerification,
  scoreErrorMessage,
  updateAccountProfile,
  verifyEmail,
} from "./lib/api.js";
import type { ApiErrorBody, AuthUser, RiotId } from "./lib/types.js";
import { installLinkInterceptor, navigateTo } from "./router/navigation.js";
import { buildPlayerRoute, isAppPath, parseRoute } from "./router/routes.js";
import {
  clearResetPasswordStatus,
  hideToastPopup,
  passwordResetSentMessage,
  renderAuthUser,
  renderLoggedOut,
  setAccountChangePasswordBusy,
  setAccountEmailFormBusy,
  setAccountEmailFormLocked,
  setAccountUsernameFormLocked,
  setAccountUsernameFormBusy,
  setAuthFormBusy,
  setForgotPasswordBusy,
  setForgotPasswordExpanded,
  setResetPasswordBusy,
  setResetPasswordStatus,
  setWelcomeResendBusy,
  setVerifyEmailStatus,
  setEmailChangeWarning,
  showAccountEditField,
  showAccountView,
  showResetPasswordView,
  showToastPopup,
  showVerifyEmailView,
  showWelcomeVerifyView,
  updateRegisterPasswordMatch,
  updateResetPasswordMatch,
  setUsernameChangeWarning,
} from "./ui/auth.js";
import { els } from "./ui/dom.js";
import {
  clearMessage,
  hidePlayer,
  renderPlayer,
  revealWelcome,
  setRefreshBusy,
  showMessage,
  showWelcome,
} from "./ui/view.js";

let activePlayer: RiotId | null = null;
let currentUser: AuthUser | null = null;
let activeResetPasswordToken: string | null = null;

function normalizeEmailForCompare(value: string): string {
  return value.trim().toLowerCase();
}

async function syncProfileFieldCooldown(field: "username" | "email"): Promise<void> {
  const result = await getProfileChangeStatus();
  if (!result.ok || !result.data) return;

  if (field === "username") {
    const { allowed, message } = result.data.username;
    setUsernameChangeWarning(message, !allowed);
    setAccountUsernameFormLocked(!allowed);
    return;
  }

  const { allowed, message } = result.data.email;
  setEmailChangeWarning(message, !allowed);
  setAccountEmailFormLocked(!allowed);
}

function parseRiotId(raw: string): RiotId | null {
  const value = raw.trim();
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) return null;

  const gameName = value.slice(0, hashIndex).trim();
  const tagLine = value.slice(hashIndex + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

function setCurrentUser(user: AuthUser | null): void {
  currentUser = user;
  if (user) renderAuthUser(user);
  else renderLoggedOut();
}

async function refreshSession(): Promise<void> {
  const me = await getMe();
  if (me.ok && me.data) setCurrentUser(me.data);
  else setCurrentUser(null);
}

function authFailureMessage(result: { status: number; data: unknown }): string {
  const body =
    result.data && typeof result.data === "object" && "error" in result.data
      ? (result.data as ApiErrorBody)
      : null;
  return authErrorMessage(result.status, body);
}

function navigate(pathAndSearch: string, replace = false): void {
  navigateTo(pathAndSearch, router, { replace });
}

function migrateLegacyHashRoute(): void {
  if (!window.location.hash.startsWith("#/")) return;
  navigate(window.location.hash.slice(1), true);
}

async function handleLogin(identifier: string, password: string): Promise<void> {
  setAuthFormBusy("login", true);
  clearMessage();

  const result = await login(identifier, password);
  setAuthFormBusy("login", false);

  if (!result.ok || !result.data) {
    showMessage(authFailureMessage(result), "error");
    return;
  }

  setCurrentUser(result.data);
  clearMessage();
  navigate("/");
}

async function handleRegister(
  username: string,
  email: string,
  password: string,
  passwordConfirm: string,
): Promise<void> {
  if (password !== passwordConfirm) {
    showMessage("Passwords do not match.", "error");
    return;
  }

  setAuthFormBusy("register", true);
  clearMessage();

  const result = await register(username, email, password);
  setAuthFormBusy("register", false);

  if (!result.ok || !result.data) {
    showMessage(authFailureMessage(result), "error");
    return;
  }

  setCurrentUser(result.data);
  clearMessage();
  navigate("/welcome");
}

async function handleForgotPassword(email: string): Promise<void> {
  setForgotPasswordBusy(true);
  clearMessage();

  const result = await forgotPassword(email);
  setForgotPasswordBusy(false);

  if (!result.ok) {
    showMessage(authFailureMessage(result), "error");
    return;
  }

  setForgotPasswordExpanded(false);
  els.forgotPasswordForm.reset();
  showMessage("If that email exists, a password reset link has been sent.", "info");
}

async function handleUpdateUsername(username: string, password: string): Promise<void> {
  if (!currentUser) return;
  const normalizedUsername = username.trim();
  if (!normalizedUsername || normalizedUsername === currentUser.username) {
    showToastPopup("New username cannot be the same as the current username.");
    return;
  }

  setAccountUsernameFormBusy(true);
  clearMessage();

  const result = await updateAccountProfile(normalizedUsername, currentUser.email, password);
  setAccountUsernameFormBusy(false);

  if (!result.ok || !result.data) {
    const message = authFailureMessage(result);
    if (result.status === 429) showToastPopup(message);
    else showMessage(message, "error");
    void syncProfileFieldCooldown("username");
    return;
  }

  setCurrentUser(result.data);
  clearMessage();
  navigate("/account");
  showToastPopup("Username updated.");
}

async function handleUpdateEmail(email: string, password: string): Promise<void> {
  if (!currentUser) return;
  const normalizedEmail = normalizeEmailForCompare(email);
  if (!normalizedEmail || normalizedEmail === normalizeEmailForCompare(currentUser.email)) {
    showToastPopup("New email cannot be the same as the current email.");
    return;
  }

  setAccountEmailFormBusy(true);
  clearMessage();

  const result = await updateAccountProfile(currentUser.username, normalizedEmail, password);
  setAccountEmailFormBusy(false);

  if (!result.ok || !result.data) {
    const message = authFailureMessage(result);
    if (result.status === 429) showToastPopup(message);
    else showMessage(message, "error");
    void syncProfileFieldCooldown("email");
    return;
  }

  setCurrentUser(result.data);
  clearMessage();
  navigate("/account");
  showToastPopup("Verification email sent. Your email updates after you verify it.");
}

async function handleRequestPasswordReset(): Promise<void> {
  if (!currentUser) return;

  setAccountChangePasswordBusy(true);
  clearMessage();

  const result = await requestPasswordReset();
  setAccountChangePasswordBusy(false);

  if (!result.ok) {
    showMessage(authFailureMessage(result), "error");
    return;
  }

  showToastPopup(passwordResetSentMessage(currentUser.email));
}

async function handleResetPassword(password: string, passwordConfirm: string): Promise<void> {
  if (!activeResetPasswordToken) {
    setResetPasswordStatus("error", "Reset token is required.");
    return;
  }
  if (password !== passwordConfirm) {
    setResetPasswordStatus("error", "Passwords do not match.");
    return;
  }

  setResetPasswordBusy(true);
  setResetPasswordStatus("loading", "Updating your password...");

  const result = await resetPassword(activeResetPasswordToken, password);
  setResetPasswordBusy(false);

  if (!result.ok) {
    setResetPasswordStatus("error", authFailureMessage(result));
    return;
  }

  setCurrentUser(null);
  els.resetPasswordForm.reset();
  updateResetPasswordMatch("", "");
  setResetPasswordStatus("success", "Password updated. You can now log in.");
}

async function handleLogout(): Promise<void> {
  clearMessage();
  await logout();
  setCurrentUser(null);
  activePlayer = null;
  navigate("/");
}

async function handleWelcomeResendVerification(): Promise<void> {
  setWelcomeResendBusy(true);
  clearMessage();

  const result = await resendVerification();
  setWelcomeResendBusy(false);

  if (!result.ok) {
    showMessage(authFailureMessage(result), "error");
    return;
  }

  showToastPopup("New verification email sent.");
}

async function handleVerifyEmail(token: string): Promise<void> {
  showVerifyEmailView();
  setVerifyEmailStatus("loading", "Verifying your email...");

  const result = await verifyEmail(token);
  if (!result.ok) {
    setVerifyEmailStatus("error", authFailureMessage(result));
    return;
  }

  await refreshSession();
  setVerifyEmailStatus("success", "Email verified. You can return home.");
}

async function searchAndShow(gameName: string, tagLine: string): Promise<void> {
  activePlayer = { gameName, tagLine };
  showMessage(`Loading ${gameName}#${tagLine}...`, "loading");

  const history = await getScoreAndHistory(gameName, tagLine);
  if (!history.ok || !history.data) {
    showMessage(scoreErrorMessage(history.status), "error");
    revealWelcome();
    hidePlayer();
    return;
  }

  clearMessage();
  renderPlayer(history.data);
}

async function refreshActivePlayer(): Promise<void> {
  if (!activePlayer) return;

  const { gameName, tagLine } = activePlayer;
  setRefreshBusy(true);
  clearMessage();

  const history = await getScoreAndHistory(gameName, tagLine);
  setRefreshBusy(false);

  if (!history.ok || !history.data) {
    showMessage(scoreErrorMessage(history.status), "error");
    return;
  }

  clearMessage();
  renderPlayer(history.data);
}

function router(): void {
  hideToastPopup();
  clearMessage();
  clearResetPasswordStatus();
  const route = parseRoute(window.location.pathname, window.location.search);
  activeResetPasswordToken = null;

  switch (route.kind) {
    case "verifyEmail": {
      if (!route.token) {
        showVerifyEmailView();
        setVerifyEmailStatus("error", "Verification token is required.");
        return;
      }
      void handleVerifyEmail(route.token);
      return;
    }
    case "resetPassword": {
      showResetPasswordView();
      if (!route.token) {
        setResetPasswordStatus("error", "Reset token is required.");
        return;
      }
      activeResetPasswordToken = route.token;
      return;
    }
    case "welcome": {
      if (!currentUser) {
        navigate("/account", true);
        return;
      }
      if (currentUser.emailVerified) {
        navigate("/", true);
        return;
      }
      showWelcomeVerifyView(currentUser);
      return;
    }
    case "account":
      if (currentUser) showAccountView(currentUser);
      else showAccountView(null, route.guestMode);
      return;
    case "accountEdit": {
      if (!currentUser) {
        navigate("/login", true);
        return;
      }
      showAccountEditField(currentUser, route.field);
      void syncProfileFieldCooldown(route.field);
      return;
    }
    case "player":
      els.searchInput.value = `${route.riotId.gameName}#${route.riotId.tagLine}`;
      void searchAndShow(route.riotId.gameName, route.riotId.tagLine);
      return;
    case "home":
      activePlayer = null;
      showWelcome();
      return;
  }
}

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseRiotId(els.searchInput.value);
  if (!parsed) {
    showMessage("Enter a Riot ID like Faker#KR1 (GameName#TagLine).", "error");
    return;
  }

  const targetPath = buildPlayerRoute(parsed.gameName, parsed.tagLine);
  if (window.location.pathname === targetPath) {
    void searchAndShow(parsed.gameName, parsed.tagLine);
  } else {
    navigate(targetPath);
  }
});

els.refreshButton.addEventListener("click", () => void refreshActivePlayer());

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleLogin(els.loginIdentifier.value, els.loginPassword.value);
});

els.forgotPasswordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleForgotPassword(els.forgotPasswordEmail.value);
});

els.registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleRegister(
    els.registerUsername.value,
    els.registerEmail.value,
    els.registerPassword.value,
    els.registerPasswordConfirm.value,
  );
});

els.accountUsernameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleUpdateUsername(els.accountNewUsername.value, els.accountUsernamePassword.value);
});

els.accountEmailForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleUpdateEmail(els.accountNewEmail.value, els.accountEmailPassword.value);
});

els.resetPasswordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleResetPassword(els.resetPassword.value, els.resetPasswordConfirm.value);
});

els.logoutButton.addEventListener("click", () => void handleLogout());
els.accountChangePassword.addEventListener("click", () => void handleRequestPasswordReset());
els.welcomeResendButton.addEventListener("click", () => void handleWelcomeResendVerification());
els.toastPopupDismiss.addEventListener("click", () => hideToastPopup());
els.toastPopup.addEventListener("click", (event) => {
  if (event.target === els.toastPopup) hideToastPopup();
});

els.showRegisterButton.addEventListener("click", () => navigate("/register"));
els.showLoginButton.addEventListener("click", () => navigate("/login"));
els.showForgotPasswordButton.addEventListener("click", () => {
  clearMessage();
  setForgotPasswordExpanded(true);
  els.forgotPasswordEmail.focus();
});
els.forgotPasswordCancel.addEventListener("click", () => {
  setForgotPasswordExpanded(false);
  els.forgotPasswordForm.reset();
});

function syncRegisterPasswordMatch(): void {
  updateRegisterPasswordMatch(els.registerPassword.value, els.registerPasswordConfirm.value);
}

function syncResetPasswordMatch(): void {
  updateResetPasswordMatch(els.resetPassword.value, els.resetPasswordConfirm.value);
}

els.registerPassword.addEventListener("input", syncRegisterPasswordMatch);
els.registerPasswordConfirm.addEventListener("input", syncRegisterPasswordMatch);
els.resetPassword.addEventListener("input", syncResetPasswordMatch);
els.resetPasswordConfirm.addEventListener("input", syncResetPasswordMatch);

window.addEventListener("popstate", router);
installLinkInterceptor(router, isAppPath);

migrateLegacyHashRoute();

async function start(): Promise<void> {
  await refreshSession();
  router();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => void start(), { once: true });
} else {
  void start();
}
