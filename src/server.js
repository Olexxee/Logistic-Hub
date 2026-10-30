import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";

const startedAt = Date.now();
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shutdownPromise;

function log(level, event, details = {}) {
  const writer = level === "fatal" ? console.error : (console[level] ?? console.log);
  writer(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "logistic-hub-api",
    event,
    environment: env.NODE_ENV,
    ...details,
  }));
}

const server = app.listen(env.PORT);

server.on("listening", () => {
  const address = server.address();
  log("info", "server.listening", {
    port: typeof address === "object" && address ? address.port : env.PORT,
    host: typeof address === "object" && address ? address.address : undefined,
    pid: process.pid,
    nodeVersion: process.version,
  });

  // Keep the HTTP process alive when PostgreSQL is unavailable so that
  // liveness diagnostics remain reachable; readiness returns HTTP 503.
  void checkDatabaseConnection();
});

server.on("error", (error) => {
  log("error", "server.error", {
    errorName: error.name,
    errorCode: error.code,
    message: error.message,
  });
  process.exitCode = 1;
  void shutdown("server_error", 1);
});

async function checkDatabaseConnection() {
  const checkStartedAt = Date.now();
  const databaseUrl = new URL(env.DATABASE_URL);
  const databaseTarget = {
    provider: "postgresql",
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 5432),
    database: databaseUrl.pathname.slice(1) || "unknown",
  };

  log("info", "database.connection_check.started", databaseTarget);

  try {
    // A query verifies both that Prisma can establish a connection and that
    // PostgreSQL can execute a request. Never log DATABASE_URL or credentials.
    await prisma.$queryRaw`SELECT 1`;

    log("info", "database.connected", {
      ...databaseTarget,
      latencyMs: Date.now() - checkStartedAt,
    });
    return true;
  } catch (error) {
    log("error", "database.connection_failed", {
      ...databaseTarget,
      latencyMs: Date.now() - checkStartedAt,
      errorName: error?.name,
      errorCode: error?.code,
      clientVersion: error?.clientVersion,
      message: error?.message,
      action: "Verify DNS resolution, outbound TCP access to the configured database host and port, DATABASE_URL credentials, and Prisma Postgres availability.",
    });
    return false;
  }
}

async function shutdown(signal, exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    process.exitCode = Math.max(process.exitCode ?? 0, exitCode);
    log("info", "server.shutdown.started", {
      signal,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });

    const forceExitTimer = setTimeout(() => {
      log("error", "server.shutdown.timeout", {
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      server.closeAllConnections?.();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      await new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }

        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections?.();
      });

      log("info", "server.http.closed");
    } catch (error) {
      process.exitCode = 1;
      log("error", "server.http.close_failed", {
        errorName: error.name,
        errorCode: error.code,
        message: error.message,
      });
    }

    try {
      await prisma.$disconnect();
      log("info", "database.disconnected");
    } catch (error) {
      process.exitCode = 1;
      log("error", "database.disconnect_failed", {
        errorName: error.name,
        errorCode: error.code,
        message: error.message,
      });
    } finally {
      clearTimeout(forceExitTimer);
    }

    log("info", "server.shutdown.completed", {
      exitCode: process.exitCode ?? 0,
    });
  })();

  return shutdownPromise;
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log("error", "process.unhandled_rejection", {
    reason: reason instanceof Error
      ? { name: reason.name, message: reason.message, stack: reason.stack }
      : String(reason),
  });
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  log("fatal", "process.uncaught_exception", {
    errorName: error.name,
    message: error.message,
    stack: error.stack,
  });
  void shutdown("uncaughtException", 1);
});
