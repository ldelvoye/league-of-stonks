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
import { logger, flushDdLogs } from "./lib/logger.js";

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
  logger.info("Backend server started", {
    event: "server.lifecycle.started",
    category: "server",
    action: "startup",
    outcome: "success",
    port,
    env: config.nodeEnv(),
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info("Backend shutdown initiated", {
    event: "server.lifecycle.shutdown_initiated",
    category: "server",
    action: "shutdown",
    outcome: "started",
    signal,
  });

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
  logger.info("Backend shutdown completed", {
    event: "server.lifecycle.shutdown_completed",
    category: "server",
    action: "shutdown",
    outcome: "success",
  });
  // Flush any buffered log entries to Datadog before the process exits.
  await flushDdLogs();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
