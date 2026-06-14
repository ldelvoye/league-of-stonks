export interface LogContext {
  [key: string]: unknown;
}

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, msg: string, context?: LogContext): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...context,
  };
  const line = JSON.stringify(entry);
  // Route warn/error to stderr so they are separable from info in log aggregators.
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  info(msg: string, context?: LogContext): void {
    write("info", msg, context);
  },
  warn(msg: string, context?: LogContext): void {
    write("warn", msg, context);
  },
  error(msg: string, context?: LogContext): void {
    write("error", msg, context);
  },
};
