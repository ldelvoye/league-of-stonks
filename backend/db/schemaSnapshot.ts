import dotenv from "dotenv";
dotenv.config({ quiet: true });

import fs from "node:fs/promises";
import path from "node:path";
import { closeDb, getPool, initDb } from "./index.js";
import { runMigrations } from "./migrations.js";

const OUTPUT_PATH = path.resolve(process.cwd(), "backend/db/schema.snapshot.md");

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  table_name: string;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  is_not_null: boolean;
  column_default: string | null;
}

interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  definition: string;
}

interface IndexRow {
  table_name: string;
  index_name: string;
  definition: string;
}

function groupRowsByTableName<T extends { table_name: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.table_name);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.table_name, [row]);
    }
  }
  return grouped;
}

function formatInline(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function normalizeSnapshot(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trimEnd().concat("\n");
}

function renderSchemaSnapshot(
  tableNames: string[],
  columnsByTable: Map<string, ColumnRow[]>,
  constraintsByTable: Map<string, ConstraintRow[]>,
  indexesByTable: Map<string, IndexRow[]>,
): string {
  const lines: string[] = [
    "# Database schema snapshot",
    "",
    "This reference reflects the `public` schema after all migrations have been applied.",
    "",
    "## Tables",
    "",
  ];

  for (const tableName of tableNames) {
    lines.push(`### ${formatInline(tableName)}`);
    lines.push("");

    const columns = columnsByTable.get(tableName) ?? [];
    for (const column of columns) {
      const suffix: string[] = [];
      if (column.is_not_null) {
        suffix.push("NOT NULL");
      }
      if (column.column_default) {
        suffix.push(`DEFAULT ${column.column_default}`);
      }
      const details = suffix.length > 0 ? ` (${suffix.join(", ")})` : "";
      lines.push(
        `- ${formatInline(column.column_name)} ${formatInline(column.data_type)}${details}`,
      );
    }

    if (columns.length === 0) {
      lines.push("- _No columns found_");
    }

    lines.push("");
    lines.push("Constraints:");
    const constraints = constraintsByTable.get(tableName) ?? [];
    if (constraints.length === 0) {
      lines.push("- _None_");
    } else {
      for (const constraint of constraints) {
        lines.push(`- ${formatInline(constraint.constraint_name)}: ${constraint.definition}`);
      }
    }

    lines.push("");
    lines.push("Indexes:");
    const indexes = indexesByTable.get(tableName) ?? [];
    if (indexes.length === 0) {
      lines.push("- _None_");
    } else {
      for (const index of indexes) {
        lines.push(`- ${formatInline(index.index_name)}: ${index.definition}`);
      }
    }

    lines.push("");
  }

  return normalizeSnapshot(lines.join("\n"));
}

await initDb();
try {
  const applied = await runMigrations();
  if (applied.length === 0) {
    console.log("No pending migrations");
  } else {
    console.log(`Applied ${applied.length} migration(s):`);
    for (const migration of applied) {
      console.log(`- ${migration.version}: ${migration.filename}`);
    }
  }

  const pool = getPool();
  const [tablesResult, columnsResult, constraintsResult, indexesResult] = await Promise.all([
    pool.query<TableRow>(
      `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
       ORDER BY c.relname ASC`,
    ),
    pool.query<ColumnRow>(
      `SELECT
         c.relname AS table_name,
         a.attnum AS ordinal_position,
         a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS is_not_null,
         pg_get_expr(ad.adbin, ad.adrelid) AS column_default
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
       LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND a.attnum > 0
         AND NOT a.attisdropped
       ORDER BY c.relname ASC, a.attnum ASC`,
    ),
    pool.query<ConstraintRow>(
      `SELECT
         c.relname AS table_name,
         con.conname AS constraint_name,
         pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
       ORDER BY c.relname ASC, con.conname ASC`,
    ),
    pool.query<IndexRow>(
      `SELECT
         t.relname AS table_name,
         i.relname AS index_name,
         pg_get_indexdef(i.oid) AS definition
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_constraint con ON con.conindid = i.oid
       WHERE n.nspname = 'public'
         AND con.oid IS NULL
       ORDER BY t.relname ASC, i.relname ASC`,
    ),
  ]);

  const tableNames = tablesResult.rows.map((row) => row.table_name);
  const columnsByTable = groupRowsByTableName(columnsResult.rows);
  const constraintsByTable = groupRowsByTableName(constraintsResult.rows);
  const indexesByTable = groupRowsByTableName(indexesResult.rows);
  const snapshot = renderSchemaSnapshot(
    tableNames,
    columnsByTable,
    constraintsByTable,
    indexesByTable,
  );

  await fs.writeFile(OUTPUT_PATH, snapshot, "utf8");
  console.log(`Wrote schema snapshot to ${OUTPUT_PATH}`);
} finally {
  await closeDb();
}
