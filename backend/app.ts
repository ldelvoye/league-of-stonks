import { randomUUID } from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import healthRouter from "./routes/health.js";
import playerRouter from "./routes/player.js";
import authRouter from "./routes/auth.js";
import portfolioRouter from "./routes/portfolio.js";
import marketRouter from "./routes/market.js";
import jobsRouter from "./routes/jobs.js";
import { RiotApiError } from "./lib/riot.js";
import { PortfolioServiceError } from "./lib/portfolioService.js";
import { config } from "./lib/config.js";
import { logger, toErrorObj } from "./lib/logger.js";

function riotErrorStatus(riotStatus: number): number {
  if (riotStatus === 404) return 404;
  if (riotStatus === 429) return 429;
  return 502;
}

export function createApp() {
  const app = express();

  // Railway and most managed hosts sit behind a reverse proxy; this tells
  // Express to trust the X-Forwarded-For header so IP-based rate limiters
  // see the real client IP rather than the proxy's address.
  app.set("trust proxy", 1);

  const allowedOrigins = new Set(config.allowedOrigins());

  app.use(express.json({ limit: "16kb" }));

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

  // Attach a unique request ID and emit a structured log line when the
  // response finishes. The requestId is stored on res.locals so the global
  // error handler can include it in error logs.
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startMs = Date.now();
    const requestPath = req.originalUrl;
    const requestMethod = req.method;
    const requestIp = req.ip;
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
      const durationMs = Date.now() - startMs;
      const logFn = res.statusCode >= 500 ? logger.error : logger.info;
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      logFn("request", {
        requestId,
        method: requestMethod,
        path: requestPath,
        status: res.statusCode,
        statusClass,
        durationMs,
        ip: requestIp,
      });
    });

    next();
  });

  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/player", playerRouter);
  app.use("/api/portfolio", portfolioRouter);
  app.use("/api/market", marketRouter);
  app.use("/api/jobs", jobsRouter);

  // Global error handler. Normalizes known domain errors (RiotApiError,
  // PortfolioServiceError) and catches unexpected errors from all routes so
  // the duplicate per-route try/catch patterns can be removed over time.
  // Express 5 automatically forwards async route errors to this handler.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;

    if (err instanceof RiotApiError) {
      const status = riotErrorStatus(err.status);
      if (err.status === 429) {
        logger.warn("riot rate limit hit", {
          requestId,
          step: err.step,
          riotStatus: err.status,
          method: req.method,
          path: req.originalUrl,
        });
      } else {
        logger.error("riot api error", {
          requestId,
          step: err.step,
          riotStatus: err.status,
          method: req.method,
          path: req.originalUrl,
        });
      }
      res.status(status).json({ error: `${err.step} lookup failed` });
      return;
    }

    if (err instanceof PortfolioServiceError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
      return;
    }

    logger.error("unhandled error", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      error: toErrorObj(err),
    });

    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
