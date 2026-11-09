import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { emailService } from "./shared/email/email.service.js";
import { createOutboxWorker } from "./shared/jobs/outbox-worker.service.js";
import { createDriverAssignmentExpiryWorker } from "./shared/jobs/driver-assignment-expiry.service.js";
import { createDriverEligibilityAlertWorker } from "./shared/jobs/driver-eligibility-alert-worker.service.js";
import { createIntegrationWebhookDeliveryWorker } from "./shared/jobs/integration-webhook-delivery-worker.service.js";

const startedAt = Date.now();
const SHUTDOWN_TIMEOUT_MS = 10_000;
const OUTBOX_POLL_INTERVAL_MS = 1_000;
const ASSIGNMENT_EXPIRY_POLL_INTERVAL_MS = 30_000;
const DRIVER_ELIGIBILITY_ALERT_POLL_INTERVAL_MS = 60_000;
const WEBHOOK_DELIVERY_POLL_INTERVAL_MS = 1_000;
let shutdownPromise;
let outboxWorker;
let outboxWorkerTimer;
let outboxWorkerPoll;
let outboxWorkerStopping = false;
let outboxWorkerFailures = 0;
let assignmentExpiryWorker;
let assignmentExpiryTimer;
let assignmentExpiryPoll;
let assignmentExpiryStopping = false;
let assignmentExpiryFailures = 0;
let driverEligibilityAlertWorker;
let driverEligibilityAlertTimer;
let driverEligibilityAlertPoll;
let driverEligibilityAlertStopping = false;
let driverEligibilityAlertFailures = 0;
let webhookDeliveryWorker;
let webhookDeliveryTimer;
let webhookDeliveryPoll;
let webhookDeliveryStopping = false;
let webhookDeliveryFailures = 0;

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

function startOutboxWorker() {
  if (outboxWorker || outboxWorkerStopping) return;

  if (!emailService.configured) {
    log("warn", "outbox.worker.disabled", {
      reason: "email_provider_not_configured",
    });
    return;
  }

  outboxWorker = createOutboxWorker({
    prismaClient: prisma,
    email: emailService,
  });
  log("info", "outbox.worker.started", {
    workerId: outboxWorker.workerId,
    pollIntervalMs: OUTBOX_POLL_INTERVAL_MS,
    mode: "embedded",
  });
  void pollOutbox();
}

async function pollOutbox() {
  if (outboxWorkerStopping || !outboxWorker) return;

  outboxWorkerPoll = (async () => {
    try {
      await outboxWorker.runOnce();
      outboxWorkerFailures = 0;
    } catch (error) {
      outboxWorkerFailures += 1;
      log("error", "outbox.poll.failed", {
        errorName: error?.name,
        errorCode: error?.code ?? "WORKER_ERROR",
        message: error?.message,
        consecutiveFailures: outboxWorkerFailures,
      });
    }
  })();

  await outboxWorkerPoll;
  outboxWorkerPoll = undefined;

  if (!outboxWorkerStopping) {
    const retryDelayMs = outboxWorkerFailures
      ? Math.min(30_000, OUTBOX_POLL_INTERVAL_MS * (2 ** Math.min(outboxWorkerFailures, 5)))
      : OUTBOX_POLL_INTERVAL_MS;
    outboxWorkerTimer = setTimeout(() => void pollOutbox(), retryDelayMs);
    outboxWorkerTimer.unref?.();
  }
}

async function stopOutboxWorker(signal) {
  outboxWorkerStopping = true;
  if (outboxWorkerTimer) clearTimeout(outboxWorkerTimer);
  outboxWorkerTimer = undefined;

  if (outboxWorkerPoll) await outboxWorkerPoll;

  if (outboxWorker) {
    log("info", "outbox.worker.stopped", {
      workerId: outboxWorker.workerId,
      signal,
    });
  }
}


function startWebhookDeliveryWorker() {
  if (webhookDeliveryWorker || webhookDeliveryStopping) return;
  if (!env.WEBHOOK_SECRET_ENCRYPTION_KEY.trim()) {
    log("warn", "integration.webhook.worker.disabled", {
      reason: "webhook_secret_encryption_key_not_configured",
    });
    return;
  }
  webhookDeliveryWorker = createIntegrationWebhookDeliveryWorker({
    prismaClient: prisma,
    encryptionKey: env.WEBHOOK_SECRET_ENCRYPTION_KEY,
  });
  log("info", "integration.webhook.worker.started", {
    workerId: webhookDeliveryWorker.workerId,
    pollIntervalMs: WEBHOOK_DELIVERY_POLL_INTERVAL_MS,
    mode: "embedded",
  });
  void pollWebhookDeliveries();
}

async function pollWebhookDeliveries() {
  if (webhookDeliveryStopping || !webhookDeliveryWorker) return;
  webhookDeliveryPoll = (async () => {
    try {
      await webhookDeliveryWorker.runOnce();
      webhookDeliveryFailures = 0;
    } catch (error) {
      webhookDeliveryFailures += 1;
      log("error", "integration.webhook.poll.failed", {
        errorName: error?.name,
        errorCode: error?.code ?? "WEBHOOK_WORKER_ERROR",
        message: error?.message,
        consecutiveFailures: webhookDeliveryFailures,
      });
    }
  })();
  await webhookDeliveryPoll;
  webhookDeliveryPoll = undefined;
  if (!webhookDeliveryStopping) {
    const delayMs = webhookDeliveryFailures
      ? Math.min(30_000, WEBHOOK_DELIVERY_POLL_INTERVAL_MS * (2 ** Math.min(webhookDeliveryFailures, 5)))
      : WEBHOOK_DELIVERY_POLL_INTERVAL_MS;
    webhookDeliveryTimer = setTimeout(() => void pollWebhookDeliveries(), delayMs);
    webhookDeliveryTimer.unref?.();
  }
}

async function stopWebhookDeliveryWorker(signal) {
  webhookDeliveryStopping = true;
  if (webhookDeliveryTimer) clearTimeout(webhookDeliveryTimer);
  webhookDeliveryTimer = undefined;
  if (webhookDeliveryPoll) await webhookDeliveryPoll;
  if (webhookDeliveryWorker) {
    log("info", "integration.webhook.worker.stopped", {
      workerId: webhookDeliveryWorker.workerId,
      signal,
    });
  }
}


function startDriverEligibilityAlertWorker() {
  if (driverEligibilityAlertWorker || driverEligibilityAlertStopping) return;
  driverEligibilityAlertWorker = createDriverEligibilityAlertWorker({ prismaClient: prisma });
  log("info", "driver.eligibility_alert_worker.started", {
    pollIntervalMs: DRIVER_ELIGIBILITY_ALERT_POLL_INTERVAL_MS,
    mode: "embedded",
  });
  void pollDriverEligibilityAlerts();
}

async function pollDriverEligibilityAlerts() {
  if (driverEligibilityAlertStopping || !driverEligibilityAlertWorker) return;
  driverEligibilityAlertPoll = (async () => {
    try {
      const result = await driverEligibilityAlertWorker.runOnce();
      driverEligibilityAlertFailures = 0;
      if (result.alertsCreated > 0) log("warn", "driver.eligibility_alerts.created", result);
    } catch (error) {
      driverEligibilityAlertFailures += 1;
      log("error", "driver.eligibility_alert.poll.failed", {
        errorName: error?.name,
        errorCode: error?.code ?? "DRIVER_ELIGIBILITY_ALERT_WORKER_ERROR",
        message: error?.message,
        consecutiveFailures: driverEligibilityAlertFailures,
      });
    }
  })();
  await driverEligibilityAlertPoll;
  driverEligibilityAlertPoll = undefined;
  if (!driverEligibilityAlertStopping) {
    const delayMs = driverEligibilityAlertFailures
      ? Math.min(5 * 60_000, DRIVER_ELIGIBILITY_ALERT_POLL_INTERVAL_MS * (2 ** Math.min(driverEligibilityAlertFailures, 4)))
      : DRIVER_ELIGIBILITY_ALERT_POLL_INTERVAL_MS;
    driverEligibilityAlertTimer = setTimeout(() => void pollDriverEligibilityAlerts(), delayMs);
    driverEligibilityAlertTimer.unref?.();
  }
}

async function stopDriverEligibilityAlertWorker(signal) {
  driverEligibilityAlertStopping = true;
  if (driverEligibilityAlertTimer) clearTimeout(driverEligibilityAlertTimer);
  driverEligibilityAlertTimer = undefined;
  if (driverEligibilityAlertPoll) await driverEligibilityAlertPoll;
  if (driverEligibilityAlertWorker) log("info", "driver.eligibility_alert_worker.stopped", { signal });
}

function startDriverAssignmentExpiryWorker() {
  if (assignmentExpiryWorker || assignmentExpiryStopping) return;
  assignmentExpiryWorker = createDriverAssignmentExpiryWorker({ prismaClient: prisma });
  log("info", "driver.assignment.expiry_worker.started", {
    pollIntervalMs: ASSIGNMENT_EXPIRY_POLL_INTERVAL_MS,
    mode: "embedded",
  });
  void pollDriverAssignmentExpiry();
}

async function pollDriverAssignmentExpiry() {
  if (assignmentExpiryStopping || !assignmentExpiryWorker) return;
  assignmentExpiryPoll = (async () => {
    try {
      const result = await assignmentExpiryWorker.runOnce();
      assignmentExpiryFailures = 0;
      if (result.expired > 0) log("info", "driver.assignment.reservations_expired", result);
    } catch (error) {
      assignmentExpiryFailures += 1;
      log("error", "driver.assignment.expiry_poll.failed", {
        errorName: error?.name,
        errorCode: error?.code ?? "ASSIGNMENT_EXPIRY_WORKER_ERROR",
        message: error?.message,
        consecutiveFailures: assignmentExpiryFailures,
      });
    }
  })();
  await assignmentExpiryPoll;
  assignmentExpiryPoll = undefined;
  if (!assignmentExpiryStopping) {
    const retryDelayMs = assignmentExpiryFailures
      ? Math.min(5 * 60_000, ASSIGNMENT_EXPIRY_POLL_INTERVAL_MS * (2 ** Math.min(assignmentExpiryFailures, 4)))
      : ASSIGNMENT_EXPIRY_POLL_INTERVAL_MS;
    assignmentExpiryTimer = setTimeout(() => void pollDriverAssignmentExpiry(), retryDelayMs);
    assignmentExpiryTimer.unref?.();
  }
}

async function stopDriverAssignmentExpiryWorker(signal) {
  assignmentExpiryStopping = true;
  if (assignmentExpiryTimer) clearTimeout(assignmentExpiryTimer);
  assignmentExpiryTimer = undefined;
  if (assignmentExpiryPoll) await assignmentExpiryPoll;
  if (assignmentExpiryWorker) log("info", "driver.assignment.expiry_worker.stopped", { signal });
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
  // Start after the initial connectivity check even if PostgreSQL is temporarily unavailable.
  // The poll loop backs off and retries, so a transient outage does not disable email delivery.
  void checkDatabaseConnection().then(() => {
    startOutboxWorker();
    startDriverAssignmentExpiryWorker();
    startWebhookDeliveryWorker();
  });
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

    await stopOutboxWorker(signal);
    await stopDriverAssignmentExpiryWorker(signal);
    await stopWebhookDeliveryWorker(signal);

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
