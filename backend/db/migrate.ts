import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { closeDb, initDb } from "./index.js";
import { runMigrations } from "./migrations.js";

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
} finally {
  await closeDb();
}
