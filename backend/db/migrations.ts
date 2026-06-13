import fs from "fs";
import path from "path";
import type { Pool, PoolClient } from "pg";
import { getPool } from "./index.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "backend/db/migrations");
const MIGRATION_FILE_PATTERN = /^(\d+)_.*\.sql$/;

export interface AppliedMigration {
  version: string;
  filename: string;
}

export interface MigrationStatus {
  version: string;
  filename: string;
  appliedAt: Date | null;
  isApplied: boolean;
}

type Queryable = Pick<Pool | PoolClient, "query">;
interface MigrationFile {
  version: string;
  filename: string;
  fullPath: string;
}
interface RecordedMigration {
  filename: string;
  appliedAt: Date;
}

async function ensureMigrationsTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function getSortedMigrationFiles(): MigrationFile[] {
  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = entry.name.match(MIGRATION_FILE_PATTERN);
      if (!match) {
        throw new Error(
          `Invalid migration filename "${entry.name}". Expected format "NNN_name.sql".`,
        );
      }

      return {
        version: match[1],
        filename: entry.name,
        fullPath: path.join(MIGRATIONS_DIR, entry.name),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));

  for (let i = 1; i < files.length; i += 1) {
    if (files[i - 1].version === files[i].version) {
      throw new Error(
        `Duplicate migration version "${files[i].version}" in "${files[i - 1].filename}" and "${files[i].filename}".`,
      );
    }
  }

  return files;
}

async function readRecordedMigrations(client: PoolClient): Promise<Map<string, RecordedMigration>> {
  const { rows: tableRows } = await client.query<{ relation: string | null }>(
    `SELECT to_regclass('public.schema_migrations') AS relation`,
  );
  if (!tableRows[0]?.relation) {
    return new Map();
  }

  const { rows } = await client.query<{ version: string; filename: string; applied_at: Date }>(
    `SELECT version, filename, applied_at FROM schema_migrations`,
  );
  return new Map(
    rows.map((row) => [
      row.version,
      {
        filename: row.filename,
        appliedAt: row.applied_at,
      },
    ]),
  );
}

function validateMigrationHistory(
  migrationFiles: MigrationFile[],
  recordedByVersion: Map<string, RecordedMigration>,
): void {
  const diskByVersion = new Map(migrationFiles.map((migration) => [migration.version, migration.filename]));

  for (const migration of migrationFiles) {
    const recorded = recordedByVersion.get(migration.version);
    if (recorded && recorded.filename !== migration.filename) {
      throw new Error(
        `Migration version "${migration.version}" already recorded as "${recorded.filename}" but found "${migration.filename}" on disk.`,
      );
    }
  }

  for (const [version, recorded] of recordedByVersion.entries()) {
    if (!diskByVersion.has(version)) {
      throw new Error(
        `Migration version "${version}" recorded as "${recorded.filename}" is missing from backend/db/migrations.`,
      );
    }
  }
}

export async function getMigrationStatus(db: Pool = getPool()): Promise<MigrationStatus[]> {
  const client = await db.connect();
  try {
    const migrationFiles = getSortedMigrationFiles();
    const recordedByVersion = await readRecordedMigrations(client);
    validateMigrationHistory(migrationFiles, recordedByVersion);

    return migrationFiles.map((migration) => {
      const recorded = recordedByVersion.get(migration.version);
      return {
        version: migration.version,
        filename: migration.filename,
        appliedAt: recorded?.appliedAt ?? null,
        isApplied: Boolean(recorded),
      };
    });
  } finally {
    client.release();
  }
}

export async function runMigrations(db: Pool = getPool()): Promise<AppliedMigration[]> {
  const client = await db.connect();
  try {
    await ensureMigrationsTable(client);
    const migrationFiles = getSortedMigrationFiles();
    const recordedByVersion = await readRecordedMigrations(client);
    validateMigrationHistory(migrationFiles, recordedByVersion);
    const appliedMigrations: AppliedMigration[] = [];

    for (const migration of migrationFiles) {
      if (recordedByVersion.has(migration.version)) {
        continue;
      }

      const sql = fs.readFileSync(migration.fullPath, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)`,
          [migration.version, migration.filename],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      appliedMigrations.push({
        version: migration.version,
        filename: migration.filename,
      });
    }

    return appliedMigrations;
  } finally {
    client.release();
  }
}
