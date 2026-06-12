import "dotenv/config";
import express from "express";
import { initDb } from "./db/index.js";
import healthRouter from "./routes/health.js";
import playerRouter from "./routes/player.js";

await initDb();

const app = express();
const port = process.env.PORT ?? 3000;
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set(
  configuredOrigins.length > 0 ? configuredOrigins : ["http://localhost:3001"],
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use("/health", healthRouter);
app.use("/api/player", playerRouter);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
