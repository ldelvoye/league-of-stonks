import "dotenv/config";
import { closeDb, initDb } from "./index.js";

await initDb();
console.log("Database schema ready");
await closeDb();
