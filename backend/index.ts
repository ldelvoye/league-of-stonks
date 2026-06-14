import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { createApp } from "./app.js";
import { closeDb, initDb } from "./db/index.js";
import {
  schedulePasswordResetTokenCleanup,
  scheduleSessionCleanup,
  scheduleVerificationTokenCleanup,
} from "./jobs/backgroundCleanup.js";
import { scheduleLeaderboardRefresh } from "./jobs/leaderboardRefresh.js";
import { config, validateConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";

// Fail fast on missing required environment variables before any DB or HTTP work.
validateConfig();

await initDb();
const sessionCleanupTimer = scheduleSessionCleanup();
const verificationCleanupTimer = scheduleVerificationTokenCleanup();
const passwordResetCleanupTimer = schedulePasswordResetTokenCleanup();
const leaderboardTimer = scheduleLeaderboardRefresh();

const app = createApp();
const port = config.port();

const server = app.listen(port, () => {
  logger.info("server started", { port, env: config.nodeEnv() });
});

async function shutdown(signal: string): Promise<void> {
  logger.info("shutdown initiated", { signal });

  // Stop background maintenance loops.
  clearInterval(sessionCleanupTimer);
  clearInterval(verificationCleanupTimer);
  clearInterval(passwordResetCleanupTimer);
  clearInterval(leaderboardTimer);

  // Stop accepting new connections; wait for in-flight requests to complete.
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  await closeDb();
  logger.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
