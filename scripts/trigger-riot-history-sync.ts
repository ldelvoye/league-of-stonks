/**
 * One-shot cron trigger for Railway Cron services.
 *
 * Reads SYNC_MODE, API_BASE_URL, and CRON_SECRET from env, calls the matching
 * backend maintenance endpoint, prints the JSON summary, and exits.
 *
 * Configure two separate Railway Cron services from the same repo:
 *   Leaderboard freshness (~30 min):  SYNC_MODE=leaderboard
 *   Random player discovery (~5 min): SYNC_MODE=random-discovery
 *
 * Start command for each:
 *   node --input-type=module < scripts/trigger-riot-history-sync.js
 *   -- OR after building --
 *   node backend/dist/scripts/trigger-riot-history-sync.js
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });

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

let res: Response;
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

let body: unknown;
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
