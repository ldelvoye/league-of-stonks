import pg from "pg";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function needsSsl(connectionString: string): boolean {
  if (config.isProduction()) {
    return true;
  }

  try {
    const url = new URL(connectionString.replace(/^postgres:/, "postgresql:"));
    const host = url.hostname;
    // Local docker postgres does not use SSL; remote hosts (e.g. Supabase) do.
    return host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return false;
  }
}

export async function initDb(): Promise<pg.Pool> {
  if (pool) {
    return pool;
  }

  const connectionString = config.databaseUrl();
  pool = new Pool({
    connectionString,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : false,
    max: config.dbPoolMax(),
    idleTimeoutMillis: config.dbIdleTimeoutMs(),
    connectionTimeoutMillis: config.dbConnectionTimeoutMs(),
    statement_timeout: config.dbStatementTimeoutMs(),
  });

  pool.on("error", (err) => {
    logger.error("db idle client error", { message: err.message });
  });

  pool.on("connect", () => {
    const { totalCount, idleCount, waitingCount } = pool!;
    if (waitingCount > 0) {
      logger.warn("db pool saturation", { totalCount, idleCount, waitingCount });
    }
  });

  await pool.query("SELECT 1");

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
