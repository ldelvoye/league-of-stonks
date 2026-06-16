import { purgeExpiredVerificationTokens } from "../db/tables/emailVerification.js";
import { purgeExpiredPasswordResetTokens } from "../db/tables/passwordReset.js";
import { purgeExpiredSessions } from "../db/tables/sessions.js";
import { logger, toErrorObj } from "../lib/logger.js";

const DAILY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function scheduleCleanupJob(
  job: "session_cleanup" | "email_verification_cleanup" | "password_reset_cleanup",
  run: () => Promise<void>,
): NodeJS.Timeout {
  run().catch((err) => {
    logger.error("Background cleanup job failed", {
      event: "jobs.cleanup.failed",
      category: "jobs",
      action: "cleanup",
      outcome: "failure",
      job,
      error: toErrorObj(err),
    });
  });

  const timer = setInterval(() => {
    run().catch((err) => {
      logger.error("Background cleanup job failed", {
        event: "jobs.cleanup.failed",
        category: "jobs",
        action: "cleanup",
        outcome: "failure",
        job,
        error: toErrorObj(err),
      });
    });
  }, DAILY_CLEANUP_INTERVAL_MS);

  timer.unref();
  return timer;
}

export function scheduleSessionCleanup(): NodeJS.Timeout {
  return scheduleCleanupJob("session_cleanup", purgeExpiredSessions);
}

export function scheduleVerificationTokenCleanup(): NodeJS.Timeout {
  return scheduleCleanupJob("email_verification_cleanup", purgeExpiredVerificationTokens);
}

export function schedulePasswordResetTokenCleanup(): NodeJS.Timeout {
  return scheduleCleanupJob("password_reset_cleanup", purgeExpiredPasswordResetTokens);
}
