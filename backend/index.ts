import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { createApp } from "./app.js";
import { initDb } from "./db/index.js";
import { scheduleSessionCleanup } from "./db/tables/sessions.js";
import { scheduleVerificationTokenCleanup } from "./db/tables/emailVerification.js";
import { schedulePasswordResetTokenCleanup } from "./db/tables/passwordReset.js";

await initDb();
scheduleSessionCleanup();
scheduleVerificationTokenCleanup();
schedulePasswordResetTokenCleanup();

const app = createApp();
const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
