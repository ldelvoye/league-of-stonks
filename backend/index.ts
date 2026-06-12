import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { createApp } from "./app.js";
import { initDb } from "./db/index.js";
import { scheduleSessionCleanup } from "./db/sessions.js";
import { scheduleVerificationTokenCleanup } from "./db/emailVerification.js";

await initDb();
scheduleSessionCleanup();
scheduleVerificationTokenCleanup();

const app = createApp();
const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
