import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { emailService } from "../shared/email/email.service.js";
import { createOutboxWorker } from "../shared/jobs/outbox-worker.service.js";

const POLL_INTERVAL_MS = 1_000;
const worker = createOutboxWorker({ prismaClient: prisma, email: emailService });
let stopping = false;
let activePoll;

function log(level, event, details = {}) {
  const writer = level === "error" ? console.error : console.log;
  writer(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "logistic-hub-outbox-worker",
    event,
    environment: env.NODE_ENV,
    ...details,
  }));
}

async function poll() {
  while (!stopping) {
    try {
      await worker.runOnce();
    } catch (error) {
      log("error", "outbox.poll.failed", {
        errorName: error?.name,
        errorCode: error?.code ?? "WORKER_ERROR",
        message: error?.message,
      });
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "worker.shutdown.started", { signal });
  await activePoll;
  await prisma.$disconnect();
  log("info", "worker.shutdown.completed");
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
  log("error", "worker.unhandled_rejection", { errorName: error?.name, errorCode: error?.code });
  void shutdown("unhandledRejection").finally(() => { process.exitCode = 1; });
});

if (!emailService.configured) {
  throw new Error("Configure EMAIL_PROVIDER=resend, RESEND_API_KEY and RESEND_FROM_EMAIL before starting the outbox worker.");
}
await prisma.$queryRaw`SELECT 1`;
log("info", "worker.started", { workerId: worker.workerId });
activePoll = poll();
await activePoll;
