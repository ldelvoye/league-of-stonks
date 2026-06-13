// Auth presentation: avatar button, account page, and email verification view.
import { redactEmail } from "../lib/redact.js";
import type { AuthUser } from "../lib/types.js";
import type { AccountEditField, AccountGuestMode } from "../router/routes.js";
import { els } from "./dom.js";

const USERNAME_CHANGE_WARNING_DEFAULT = "Username can only be changed once every 24 hours.";
const EMAIL_CHANGE_WARNING_DEFAULT = "Email can only be changed once every 24 hours.";

function usernameInitials(username: string): string {
  if (username.length >= 2) return username.slice(0, 2);
  return username.slice(0, 1) || "?";
}

export function renderAuthUser(user: AuthUser): void {
  els.authAvatarButton.classList.add("is-signed-in");
  els.authAvatarButton.setAttribute("aria-label", `Account: ${user.username}`);
  els.authAvatarInitials.textContent = usernameInitials(user.username);
}

export function renderLoggedOut(): void {
  els.authAvatarButton.classList.remove("is-signed-in");
  els.authAvatarButton.setAttribute("aria-label", "Log in");
  els.authAvatarInitials.textContent = "";
}

export function setWelcomeResendBusy(busy: boolean): void {
  els.welcomeResendButton.disabled = busy;
  els.welcomeResendButton.textContent = busy ? "Sending\u2026" : "Resend verification email";
}

export function hideAuthViews(): void {
  els.accountView.hidden = true;
  els.welcomeVerifyView.hidden = true;
  els.verifyEmailView.hidden = true;
  els.resetPasswordView.hidden = true;
}

function hideAccountPanels(): void {
  els.accountGuestLogin.hidden = true;
  els.accountGuestRegister.hidden = true;
  els.accountSignedIn.hidden = true;
  els.accountEditUsername.hidden = true;
  els.accountEditEmail.hidden = true;
}

function resetAuthForms(): void {
  els.loginForm.reset();
  setForgotPasswordExpanded(false);
  setForgotPasswordBusy(false);
  els.forgotPasswordForm.reset();
  els.registerForm.reset();
  updateRegisterPasswordMatch("", "");
}

export function showAccountGuestMode(mode: AccountGuestMode): void {
  hideAccountPanels();
  resetAuthForms();
  if (mode === "login") {
    els.accountGuestLogin.hidden = false;
    document.title = "Log in \u2014 League of Stonks";
  } else {
    els.accountGuestRegister.hidden = false;
    document.title = "Sign up \u2014 League of Stonks";
  }
}

export function showAccountSignedIn(user: AuthUser): void {
  hideAccountPanels();
  els.accountSignedIn.hidden = false;
  els.accountUsernameDisplay.textContent = `Signed in as ${user.username}`;
  els.accountUnverifiedPrompt.hidden = user.emailVerified;
  setAccountChangePasswordBusy(false);
  document.title = "Account \u2014 League of Stonks";
}

function resetAccountEditUsernameForm(): void {
  els.accountUsernameForm.reset();
  setUsernameChangeWarning(null, false);
  setAccountUsernameFormLocked(false);
  setAccountUsernameFormBusy(false);
}

function resetAccountEditEmailForm(): void {
  els.accountEmailForm.reset();
  setEmailChangeWarning(null, false);
  setAccountEmailFormLocked(false);
  setAccountEmailFormBusy(false);
}

export function showAccountEditField(user: AuthUser, field: AccountEditField): void {
  hideAuthViews();
  els.welcome.hidden = true;
  els.player.hidden = true;
  els.accountView.hidden = false;
  hideAccountPanels();

  if (field === "username") {
    els.accountEditUsername.hidden = false;
    resetAccountEditUsernameForm();
    els.accountNewUsername.value = user.username;
    document.title = "Change username \u2014 League of Stonks";
    return;
  }

  els.accountEditEmail.hidden = false;
  resetAccountEditEmailForm();
  document.title = "Change email \u2014 League of Stonks";
}

export function showAccountView(user: AuthUser | null, guestMode: AccountGuestMode = "login"): void {
  hideAuthViews();
  els.welcome.hidden = true;
  els.player.hidden = true;
  els.accountView.hidden = false;

  if (user) showAccountSignedIn(user);
  else showAccountGuestMode(guestMode);
}

export function showVerifyEmailView(): void {
  hideAuthViews();
  els.welcome.hidden = true;
  els.player.hidden = true;
  els.verifyEmailView.hidden = false;
  document.title = "Verify email \u2014 League of Stonks";
}

export function showResetPasswordView(): void {
  hideAuthViews();
  els.welcome.hidden = true;
  els.player.hidden = true;
  els.resetPasswordView.hidden = false;
  els.resetPasswordForm.reset();
  updateResetPasswordMatch("", "");
  setResetPasswordBusy(false);
  clearResetPasswordStatus();
  document.title = "Reset password \u2014 League of Stonks";
}

export function showWelcomeVerifyView(user: AuthUser): void {
  hideAuthViews();
  els.welcome.hidden = true;
  els.player.hidden = true;
  els.welcomeVerifyView.hidden = false;
  els.welcomeVerifyEmail.textContent = redactEmail(user.email);
  els.welcomeResendButton.disabled = false;
  els.welcomeResendButton.textContent = "Resend verification email";
  document.title = "Welcome \u2014 League of Stonks";
}

export function showToastPopup(message: string): void {
  els.toastPopupMessage.textContent = message;
  els.toastPopup.hidden = false;
}

export function hideToastPopup(): void {
  els.toastPopup.hidden = true;
}

export function setAuthFormBusy(form: "login" | "register", busy: boolean): void {
  const submit = form === "login" ? els.loginSubmit : els.registerSubmit;
  const inputs =
    form === "login"
      ? [els.loginIdentifier, els.loginPassword]
      : [els.registerUsername, els.registerEmail, els.registerPassword, els.registerPasswordConfirm];
  submit.disabled = busy;
  submit.textContent = busy
    ? form === "login"
      ? "Logging in\u2026"
      : "Creating account\u2026"
    : form === "login"
      ? "Log in"
      : "Create account";
  for (const input of inputs) input.disabled = busy;
}

export function setForgotPasswordExpanded(expanded: boolean): void {
  els.forgotPasswordForm.hidden = !expanded;
  els.showForgotPasswordButton.hidden = expanded;
}

export function setForgotPasswordBusy(busy: boolean): void {
  els.forgotPasswordEmail.disabled = busy;
  els.forgotPasswordSubmit.disabled = busy;
  els.forgotPasswordCancel.disabled = busy;
  els.forgotPasswordSubmit.textContent = busy ? "Sending\u2026" : "Send reset link";
}

export function setAccountUsernameFormBusy(busy: boolean): void {
  els.accountNewUsername.disabled = busy;
  els.accountUsernamePassword.disabled = busy;
  els.accountUsernameSubmit.disabled = busy;
  els.accountUsernameSubmit.textContent = busy ? "Saving\u2026" : "Save username";
}

export function setAccountEmailFormBusy(busy: boolean): void {
  els.accountNewEmail.disabled = busy;
  els.accountEmailPassword.disabled = busy;
  els.accountEmailSubmit.disabled = busy;
  els.accountEmailSubmit.textContent = busy ? "Saving\u2026" : "Save email";
}

export function setAccountUsernameFormLocked(locked: boolean): void {
  els.accountNewUsername.disabled = locked;
  els.accountUsernamePassword.disabled = locked;
  els.accountUsernameSubmit.disabled = locked;
}

export function setAccountEmailFormLocked(locked: boolean): void {
  els.accountNewEmail.disabled = locked;
  els.accountEmailPassword.disabled = locked;
  els.accountEmailSubmit.disabled = locked;
}

export function setUsernameChangeWarning(message: string | null, isLocked: boolean): void {
  els.accountUsernameWarning.textContent = message ?? USERNAME_CHANGE_WARNING_DEFAULT;
  els.accountUsernameWarning.classList.toggle("is-locked", isLocked);
}

export function setEmailChangeWarning(message: string | null, isLocked: boolean): void {
  els.accountEmailWarning.textContent = message ?? EMAIL_CHANGE_WARNING_DEFAULT;
  els.accountEmailWarning.classList.toggle("is-locked", isLocked);
}

export function setAccountChangePasswordBusy(busy: boolean): void {
  els.accountChangePassword.disabled = busy;
  els.accountChangePassword.textContent = busy ? "Sending\u2026" : "Edit password";
}

export function passwordResetSentMessage(email: string): string {
  return `A password reset link was sent to ${redactEmail(email)}.`;
}

export function updateRegisterPasswordMatch(password: string, confirm: string): void {
  const feedback = els.registerPasswordMatch;
  if (!confirm) {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.className = "field-feedback";
    return;
  }

  const matches = password === confirm;
  feedback.hidden = false;
  feedback.className = `field-feedback ${matches ? "is-match" : "is-mismatch"}`;
  feedback.textContent = matches ? "Passwords match" : "Passwords do not match";
}

export function updateResetPasswordMatch(password: string, confirm: string): void {
  const feedback = els.resetPasswordMatch;
  if (!confirm) {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.className = "field-feedback";
    return;
  }

  const matches = password === confirm;
  feedback.hidden = false;
  feedback.className = `field-feedback ${matches ? "is-match" : "is-mismatch"}`;
  feedback.textContent = matches ? "Passwords match" : "Passwords do not match";
}

export function setResetPasswordBusy(busy: boolean): void {
  els.resetPassword.disabled = busy;
  els.resetPasswordConfirm.disabled = busy;
  els.resetPasswordSubmit.disabled = busy;
  els.resetPasswordSubmit.textContent = busy ? "Updating\u2026" : "Update password";
}

export function clearResetPasswordStatus(): void {
  els.resetPasswordStatus.hidden = true;
  els.resetPasswordStatus.textContent = "";
  els.resetPasswordStatus.className = "auth-status";
}

export function setResetPasswordStatus(
  variant: "loading" | "success" | "error",
  message: string,
): void {
  els.resetPasswordStatus.hidden = false;
  els.resetPasswordStatus.className = "auth-status";
  els.resetPasswordStatus.textContent = message;
  if (variant === "loading") {
    els.resetPasswordStatus.classList.add("is-loading");
    els.resetPasswordStatus.innerHTML = "";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    const label = document.createElement("span");
    label.textContent = message;
    els.resetPasswordStatus.append(spinner, label);
  } else if (variant === "error") {
    els.resetPasswordStatus.classList.add("is-error");
  } else {
    els.resetPasswordStatus.classList.add("is-success");
  }
}

export function setVerifyEmailStatus(
  variant: "loading" | "success" | "error",
  message: string,
): void {
  els.verifyEmailStatus.className = "auth-status";
  els.verifyEmailStatus.textContent = message;
  if (variant === "loading") {
    els.verifyEmailStatus.classList.add("is-loading");
    els.verifyEmailStatus.innerHTML = "";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    const label = document.createElement("span");
    label.textContent = message;
    els.verifyEmailStatus.append(spinner, label);
  } else if (variant === "error") {
    els.verifyEmailStatus.classList.add("is-error");
  } else {
    els.verifyEmailStatus.classList.add("is-success");
  }
}
