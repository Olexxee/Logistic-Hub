import { randomUUID } from "node:crypto";
import { decryptJobPayload } from "./outbox-crypto.js";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;

function retryDelayMs(attempt) {
  return Math.min(60 * 60_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
}

export function createOutboxWorker({
  prismaClient,
  email,
  logger = console,
  clock = () => new Date(),
  workerId = randomUUID(),
  batchSize = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  encryptionKey,
}) {
  if (!prismaClient || !email) throw new Error("Prisma and an email provider are required.");

  async function claimJobs() {
    return prismaClient.$queryRaw`
      WITH candidates AS (
        SELECT "id"
        FROM "outbox_jobs"
        WHERE (
          "status" = 'PENDING' AND "availableAt" <= ${clock()}
        ) OR (
          "status" = 'PROCESSING' AND "lockedAt" < ${new Date(clock().getTime() - leaseMs)}
        )
        ORDER BY "availableAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "outbox_jobs" AS jobs
      SET "status" = 'PROCESSING',
          "lockedAt" = ${clock()},
          "lockedBy" = ${workerId},
          "attempts" = jobs."attempts" + 1,
          "updatedAt" = ${clock()}
      FROM candidates
      WHERE jobs."id" = candidates."id"
      RETURNING jobs."id", jobs."topic", jobs."encryptedPayload", jobs."idempotencyKey", jobs."attempts"
    `;
  }

  async function processJob(job) {
    try {
      if (job.topic !== "email.send") {
        const error = new Error("Unsupported outbox topic.");
        error.code = "UNSUPPORTED_OUTBOX_TOPIC";
        throw error;
      }
      const payload = decryptJobPayload(job.encryptedPayload, encryptionKey);
      const result = await email.send({ ...payload, idempotencyKey: job.idempotencyKey });
      if (payload.notificationId) {
        await prismaClient.notification.updateMany({
          where: { id: payload.notificationId, emailStatus: "PENDING" },
          data: { emailStatus: "SENT", emailSentAt: clock(), emailProviderId: result?.id ?? null, emailErrorCode: null },
        });
      }
      await prismaClient.outboxJob.updateMany({
        where: { id: job.id, status: "PROCESSING", lockedBy: workerId },
        data: {
          status: "SUCCEEDED",
          processedAt: clock(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        },
      });
      return { id: job.id, status: "SUCCEEDED", providerId: result?.id ?? null };
    } catch (error) {
      const terminal = job.attempts >= maxAttempts;
      const code = typeof error?.code === "string" ? error.code.slice(0, 80) : "EMAIL_DELIVERY_FAILED";
      if (terminal) {
        try {
          const payload = decryptJobPayload(job.encryptedPayload, encryptionKey);
          if (payload.notificationId) {
            await prismaClient.notification.updateMany({
              where: { id: payload.notificationId, emailStatus: "PENDING" },
              data: { emailStatus: "FAILED", emailErrorCode: code },
            });
          }
        } catch {
          // A corrupt payload is dead-lettered without exposing its contents.
        }
      }
      const update = await prismaClient.outboxJob.updateMany({
        where: { id: job.id, status: "PROCESSING", lockedBy: workerId },
        data: {
          status: terminal ? "DEAD" : "PENDING",
          availableAt: new Date(clock().getTime() + retryDelayMs(job.attempts)),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: code,
        },
      });
      logger.error?.({
        event: "outbox.job.failed",
        jobId: job.id,
        topic: job.topic,
        attempt: job.attempts,
        terminal,
        errorCode: code,
        updated: update.count === 1,
      });
      return { id: job.id, status: terminal ? "DEAD" : "PENDING", errorCode: code };
    }
  }

  return Object.freeze({
    workerId,
    async runOnce() {
      const jobs = await claimJobs();
      const results = [];
      for (const job of jobs) results.push(await processJob(job));
      return results;
    },
  });
}
