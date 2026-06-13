import express from "express";
import healthRouter from "./routes/health.js";
import playerRouter from "./routes/player.js";
import authRouter from "./routes/auth.js";
import portfolioRouter from "./routes/portfolio.js";

export function createApp() {
  const app = express();
  const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(
    configuredOrigins.length > 0 ? configuredOrigins : ["http://localhost:3001"],
  );

  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
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
  app.use("/api/auth", authRouter);
  app.use("/api/player", playerRouter);
  app.use("/api/portfolio", portfolioRouter);

  return app;
}
