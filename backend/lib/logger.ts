export interface LogContext {
  // Stable machine fields for filtering/alerting.
  event?: string;
  category?: string;
  action?: string;
  outcome?: string;
  requestId?: string;
  [key: string]: unknown;
}

type LogLevel = "info" | "warn" | "error";

// Datadog expects `date` for the log timestamp, `message` for the human-readable
// body, `ddsource` for log pipeline routing, and `service`/`ddtags` for faceting.
// Read once at module load so every log line gets the same values without
// repeated env lookups.
const DD_SERVICE = process.env.DD_SERVICE ?? "league-of-stonks-backend";
const DD_SOURCE = "nodejs";
const DD_ENV = process.env.DD_ENV ?? process.env.NODE_ENV ?? "development";
const DD_VERSION = process.env.DD_VERSION;

// DD_API_KEY enables the batched HTTP transport. When unset the logger only
// writes to stdout/stderr (Railway's own log viewer).
const DD_API_KEY = process.env.DD_API_KEY ?? "";
// DD_SITE selects the Datadog intake region (e.g. "datadoghq.eu" for EU).
const DD_SITE = process.env.DD_SITE ?? "datadoghq.com";
const DD_INTAKE_URL = `https://http-intake.logs.${DD_SITE}/api/v2/logs`;

function buildStaticTags(): string {
  const tags = [`env:${DD_ENV}`];
  if (DD_VERSION) tags.push(`version:${DD_VERSION}`);
  return tags.join(",");
}

const DD_TAGS = buildStaticTags();

// node-postgres (pg) DatabaseError instances carry a SQLSTATE `code` plus rich
// locus fields that pinpoint the failing statement. Surfacing them turns an
// opaque "numeric field overflow" into an actionable log (e.g. code 22003 with a
// `detail` naming the precision/scale that overflowed). Duck-typed rather than
// importing pg so the logger stays dependency-free.
const PG_ERROR_FIELDS = [
  "code",
  "detail",
  "hint",
  "schema",
  "table",
  "column",
  "constraint",
  "dataType",
  "routine",
  "where",
] as const;

function extractDbErrorFields(err: Error): Record<string, string> | undefined {
  const record = err as unknown as Record<string, unknown>;
  // pg errors always set both `severity` and a SQLSTATE `code`. Gating on both
  // avoids mislabeling Node system errors (which also expose `code`, e.g.
  // "ENOENT") as database errors.
  if (typeof record.code !== "string" || typeof record.severity !== "string") {
    return undefined;
  }
  const fields: Record<string, string> = { severity: record.severity };
  for (const key of PG_ERROR_FIELDS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      fields[key] = value;
    }
  }
  return fields;
}

// Returns an object shaped for Datadog's standard error attributes
// (error.kind, error.message, error.stack). Import and spread as
// `{ error: toErrorObj(caught) }` on any logger.error call site. When the error
// originates from Postgres, a `db` sub-object with SQLSTATE + locus fields is
// attached.
export function toErrorObj(err: unknown): {
  kind: string;
  message: string;
  stack?: string;
  db?: Record<string, string>;
} {
  if (err instanceof Error) {
    const db = extractDbErrorFields(err);
    return {
      kind: err.constructor.name || "Error",
      message: err.message,
      stack: err.stack,
      ...(db ? { db } : {}),
    };
  }
  return { kind: "unknown", message: String(err) };
}

// ── Batched HTTP transport ────────────────────────────────────────────────────
// Buffers log entries in memory and POSTs them to Datadog's HTTP intake every
// FLUSH_INTERVAL_MS, or immediately when BATCH_MAX_SIZE is reached.
// Only active when DD_API_KEY is set; falls back to stdout/stderr only otherwise.
// Failures are silently dropped — logs remain available in Railway's log viewer.

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_MAX_SIZE = 100;

const ddQueue: Record<string, unknown>[] = [];
let ddFlushTimer: NodeJS.Timeout | null = null;

async function sendBatch(entries: Record<string, unknown>[]): Promise<void> {
  await fetch(DD_INTAKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "DD-API-KEY": DD_API_KEY,
    },
    body: JSON.stringify(entries),
  });
}

// Called by index.ts shutdown handler to drain remaining queued entries before
// the process exits. Safe to call multiple times; subsequent calls are no-ops.
export async function flushDdLogs(): Promise<void> {
  if (ddFlushTimer) {
    clearTimeout(ddFlushTimer);
    ddFlushTimer = null;
  }
  if (!DD_API_KEY || ddQueue.length === 0) return;
  const entries = ddQueue.splice(0);
  try {
    await sendBatch(entries);
  } catch {
    // Drop on network failure; logs are still captured in Railway's log viewer.
  }
}

function scheduleDdFlush(): void {
  if (ddFlushTimer) return;
  ddFlushTimer = setTimeout(() => {
    ddFlushTimer = null;
    void flushDdLogs();
  }, FLUSH_INTERVAL_MS);
  // unref so the timer doesn't keep the process alive past its natural end.
  ddFlushTimer.unref();
}

function enqueueToDd(entry: Record<string, unknown>): void {
  if (!DD_API_KEY) return;
  ddQueue.push(entry);
  if (ddQueue.length >= BATCH_MAX_SIZE) {
    void flushDdLogs();
  } else {
    scheduleDdFlush();
  }
}

// ── Core write ────────────────────────────────────────────────────────────────

function write(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    ...context,
    // `date` is Datadog's standard timestamp attribute (ISO 8601). Without it
    // Datadog stamps logs with ingestion time, shifting displayed timestamps.
    date: new Date().toISOString(),
    // `level` is automatically remapped to severity by Datadog's Node.js log
    // pipeline. We intentionally do NOT add a duplicate `status` field here
    // because request middleware uses `status` for the HTTP status code, and
    // that is a Datadog standard attribute for HTTP access logs.
    level,
    service: DD_SERVICE,
    ddsource: DD_SOURCE,
    ddtags: DD_TAGS,
    // `message` is Datadog's standard message attribute. Without it the Log
    // Explorer "Message" column shows the raw JSON blob instead of the string.
    message,
  };
  const line = JSON.stringify(entry);
  // Route warn/error to stderr so they are separable from info in log aggregators.
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
  enqueueToDd(entry);
}

export const logger = {
  info(message: string, context?: LogContext): void {
    write("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext): void {
    write("error", message, context);
  },
};
