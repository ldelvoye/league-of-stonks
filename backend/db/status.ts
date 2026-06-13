import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { closeDb, initDb } from "./index.js";
import { getMigrationStatus } from "./migrations.js";

await initDb();
try {
  const status = await getMigrationStatus();
  const appliedCount = status.filter((migration) => migration.isApplied).length;
  const pendingCount = status.length - appliedCount;

  console.log(`Migrations: ${appliedCount} applied, ${pendingCount} pending`);
  for (const migration of status) {
    const state = migration.isApplied ? "applied" : "pending";
    const appliedAt = migration.appliedAt
      ? ` @ ${migration.appliedAt.toISOString()}`
      : "";
    console.log(`[${state}] ${migration.version}: ${migration.filename}${appliedAt}`);
  }
} finally {
  await closeDb();
}
