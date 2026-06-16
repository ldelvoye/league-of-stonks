import { Resend } from "resend";
import { logger } from "./logger.js";

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  return new Resend(apiKey);
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "no-reply@leagueofstonks.com";
}

export async function sendVerificationEmail(toEmail: string, rawToken: string): Promise<void> {
  const link = `${appBaseUrl()}/verify-email?token=${rawToken}`;

  if (!process.env.RESEND_API_KEY) {
    // Dev fallback: log the link so development works without a real API key.
    logger.info("Verification email skipped; dev fallback link generated", {
      event: "auth.verification_email.dev_fallback",
      category: "auth",
      action: "send_verification_email",
      outcome: "skipped",
      email: toEmail,
      verificationLink: link,
    });
    return;
  }

  const resend = getResendClient();
  const { error } = await resend.emails.send({
    from: emailFrom(),
    to: toEmail,
    subject: "Verify your League of Stonks email",
    html: `
      <p>Welcome to League of Stonks!</p>
      <p>Click the link below to verify your email address. It expires in 24 hours.</p>
      <p><a href="${link}">${link}</a></p>
      <p>If you did not create an account, you can ignore this email.</p>
    `,
  });

  if (error) {
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}

export async function sendPasswordResetEmail(toEmail: string, rawToken: string): Promise<void> {
  const link = `${appBaseUrl()}/reset-password?token=${rawToken}`;

  if (!process.env.RESEND_API_KEY) {
    // Dev fallback: log the link so development works without a real API key.
    logger.info("Password reset email skipped; dev fallback link generated", {
      event: "auth.password_reset_email.dev_fallback",
      category: "auth",
      action: "send_password_reset_email",
      outcome: "skipped",
      email: toEmail,
      passwordResetLink: link,
    });
    return;
  }

  const resend = getResendClient();
  const { error } = await resend.emails.send({
    from: emailFrom(),
    to: toEmail,
    subject: "Reset your League of Stonks password",
    html: `
      <p>We received a request to reset your League of Stonks password.</p>
      <p>Click the link below to choose a new password. It expires in 1 hour.</p>
      <p><a href="${link}">${link}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });

  if (error) {
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
}
