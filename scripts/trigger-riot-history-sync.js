/**
 * One-shot cron trigger for Railway Cron services.
 *
 * Plain JavaScript — no build step required. Railway Cron service config:
 *   Build command:  npm ci
 *   Start command:  node scripts/trigger-riot-history-sync.js
 *
 * Required env vars (set on the Railway Cron service, not the backend):
 *   SYNC_MODE     — "leaderboard" or "random-discovery"
 *   API_BASE_URL  — base URL of the deployed backend, e.g. https://api.leagueofstonks.com
 *   CRON_SECRET   — shared secret matching the backend's CRON_SECRET
 *
 * Optional:
 *   DOTENV_PATH   — path to a .env file; only needed for local testing
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ quiet: true });

const mode = process.env.SYNC_MODE;
const apiBase = process.env.API_BASE_URL;
const secret = process.env.CRON_SECRET;

if (!mode || (mode !== "leaderboard" && mode !== "random-discovery")) {
  console.error("SYNC_MODE must be 'leaderboard' or 'random-discovery'");
  process.exit(1);
}

if (!apiBase) {
  console.error("API_BASE_URL is required");
  process.exit(1);
}

if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const endpoint =
  mode === "leaderboard"
    ? `${apiBase}/api/jobs/riot-history-sync/leaderboard`
    : `${apiBase}/api/jobs/riot-history-sync/random`;

let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });
} catch (err) {
  console.error("Failed to reach backend:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

let body;
try {
  body = await res.json();
} catch {
  body = await res.text().catch(() => "(no body)");
}

console.log(JSON.stringify(body, null, 2));

if (!res.ok) {
  console.error(`Sync failed with HTTP ${res.status}`);
  process.exit(1);
}
