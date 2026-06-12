import fs from "fs";
import path from "path";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  return connectionString;
}

function needsSsl(connectionString: string): boolean {
  if (process.env.NODE_ENV === "production") {
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

async function initSchema(database: pg.Pool): Promise<void> {
  const schemaPath = path.resolve(process.cwd(), "backend/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  await database.query(schema);
}

export async function initDb(): Promise<pg.Pool> {
  if (pool) {
    return pool;
  }

  const connectionString = getConnectionString();
  pool = new Pool({
    connectionString,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : false,
  });
  await initSchema(pool);

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
