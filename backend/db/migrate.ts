import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { closeDb, initDb } from "./index.js";

await initDb();
console.log("Database schema ready");
await closeDb();
