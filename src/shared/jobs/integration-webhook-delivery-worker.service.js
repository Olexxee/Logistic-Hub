import { createHmac, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { decryptWebhookSecret, isPublicAddress } from "../../modules/integrations/integration-webhook.security.js";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 8_000;
const DNS_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 4_096;

function retryDelayMs(attempt) {
  return Math.min(60 * 60_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
}

function deliveryError(message, { code = "WEBHOOK_DELIVERY_FAILED", retryable = true, statusCode = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.statusCode = statusCode;
  return error;
}

async function resolvePublicAddress(hostname, lookup = dnsLookup) {
  let timer;
  let records;
  try {
    records = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(deliveryError("Webhook DNS lookup timed out.", { code: "WEBHOOK_DNS_TIMEOUT" })), DNS_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    if (error?.retryable === false) throw error;
    throw deliveryError("Webhook DNS lookup failed.", { code: "WEBHOOK_DNS_LOOKUP_FAILED" });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw deliveryError("Webhook hostname did not resolve.", { code: "WEBHOOK_DNS_EMPTY" });
  }
  if (records.some(record => !isPublicAddress(record.address))) {
    throw deliveryError("Webhook hostname resolved to a non-public address.", {
      code: "WEBHOOK_DNS_NON_PUBLIC",
      retryable: false,
    });
  }
  const record = records[0];
  if (isIP(record.address) !== record.family) {
    throw deliveryError("Webhook DNS returned an invalid address family.", {
      code: "WEBHOOK_DNS_INVALID_ADDRESS",
      retryable: false,
    });
  }
  return record;
}

function postPinnedHttps({ url, address, body, headers, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength(body) },
      agent: false,
      servername: url.hostname,
      rejectUnauthorized: true,
      autoSelectFamily: false,
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      let bytes = 0;
      const chunks = [];
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy(deliveryError("Webhook response exceeded the allowed size.", {
            code: "WEBHOOK_RESPONSE_TOO_LARGE",
            retryable: false,
          }));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        responseBody: Buffer.concat(chunks).toString("utf8"),
      }));
      response.on("error", reject);
    });

    const timeout = setTimeout(() => {
      request.destroy(deliveryError("Webhook request timed out.", { code: "WEBHOOK_REQUEST_TIMEOUT" }));
    }, timeoutMs);
    timeout.unref?.();
    request.on("close", () => clearTimeout(timeout));
    request.on("error", reject);
    request.end(body);
  });
}

function classifyHttpStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return null;
  const retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500;
  return deliveryError(`Webhook endpoint returned HTTP ${statusCode}.`, {
    code: `WEBHOOK_HTTP_${statusCode}`,
    retryable,
    statusCode,
  });
}

export function createIntegrationWebhookDeliveryWorker({
  prismaClient,
  logger = console,
  clock = () => new Date(),
  workerId = randomUUID(),
  batchSize = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  encryptionKey,
  lookup = dnsLookup,
  sendRequest = postPinnedHttps,
} = {}) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function claimDeliveries() {
    const now = clock();
    const expiredLease = new Date(now.getTime() - leaseMs);
    return prismaClient.$queryRaw`
      WITH candidates AS (
        SELECT d."id"
        FROM "integration_webhook_deliveries" d
        INNER JOIN "integration_webhook_endpoints" e ON e."id" = d."endpointId"
        WHERE e."status" = 'ACTIVE'
          AND (
            (d."status" = 'PENDING' AND d."availableAt" <= ${now})
            OR (d."status" = 'PROCESSING' AND d."lockedAt" < ${expiredLease})
          )
        ORDER BY d."availableAt" ASC, d."createdAt" ASC
        FOR UPDATE OF d SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "integration_webhook_deliveries" AS deliveries
      SET "status" = 'PROCESSING',
          "lockedAt" = ${now},
          "lockedBy" = ${workerId},
          "attempts" = deliveries."attempts" + 1,
          "updatedAt" = ${now}
      FROM candidates
      WHERE deliveries."id" = candidates."id"
      RETURNING deliveries."id", deliveries."eventId", deliveries."endpointId",
        deliveries."secretVersion", deliveries."attempts"
    `;
  }

  async function finish(delivery, data) {
    return prismaClient.integrationWebhookDelivery.updateMany({
      where: { id: delivery.id, status: "PROCESSING", lockedBy: workerId },
      data: {
        ...data,
        lockedAt: null,
        lockedBy: null,
        updatedAt: clock(),
      },
    });
  }

  async function processDelivery(delivery) {
    const startedAt = Date.now();
    try {
      const record = await prismaClient.integrationWebhookDelivery.findUnique({
        where: { id: delivery.id },
        select: {
          id: true, eventId: true, endpointId: true, secretVersion: true,
          event: {
            select: {
              id: true, eventType: true, sequence: true, schemaVersion: true,
              occurredAt: true, payload: true,
            },
          },
          endpoint: {
            select: { id: true, url: true, status: true, currentSecretVersion: true },
          },
          secretVersionRecord: true,
        },
      });
      if (!record || record.endpoint.status !== "ACTIVE") {
        await finish(delivery, {
          status: "DEAD",
          lastErrorCode: "WEBHOOK_ENDPOINT_NOT_ACTIVE",
          lastHttpStatus: null,
        });
        return { id: delivery.id, status: "DEAD", errorCode: "WEBHOOK_ENDPOINT_NOT_ACTIVE" };
      }

      const secretRecord = record.secretVersionRecord;
      if (!secretRecord || secretRecord.version !== delivery.secretVersion) {
        throw deliveryError("Pinned webhook secret version is unavailable.", {
          code: "WEBHOOK_SECRET_VERSION_MISSING",
          retryable: false,
        });
      }
      const secret = decryptWebhookSecret(secretRecord, { encryptionKey });
      const url = new URL(record.endpoint.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443") || isIP(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) {
        throw deliveryError("Stored webhook URL violates HTTPS policy.", {
          code: "WEBHOOK_URL_POLICY_VIOLATION",
          retryable: false,
        });
      }

      // DNS is revalidated for every attempt. The HTTPS socket connects only to
      // this validated IP while TLS still verifies the original hostname.
      const address = await resolvePublicAddress(url.hostname, lookup);
      const timestamp = String(Math.floor(clock().getTime() / 1000));
      const body = JSON.stringify({
        id: record.event.id,
        type: record.event.eventType,
        schemaVersion: record.event.schemaVersion,
        occurredAt: record.event.occurredAt.toISOString(),
        sequence: record.event.sequence,
        data: record.event.payload,
      });
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${body}`, "utf8")
        .digest("hex");
      const response = await sendRequest({
        url,
        address,
        body,
        headers: {
          "content-type": "application/json",
          "user-agent": "Logistic-Hub-Webhooks/1.0",
          "x-logistic-hub-event-id": record.event.id,
          "x-logistic-hub-delivery-id": delivery.id,
          "x-logistic-hub-event-type": record.event.eventType,
          "x-logistic-hub-event-sequence": String(record.event.sequence),
          "x-logistic-hub-timestamp": timestamp,
          "x-logistic-hub-signature": `t=${timestamp},v1=${signature}`,
        },
      });
      const httpError = classifyHttpStatus(response.statusCode);
      if (httpError) {
        await finish(delivery, {
          status: httpError.retryable && delivery.attempts < maxAttempts ? "PENDING" : "DEAD",
          availableAt: new Date(clock().getTime() + retryDelayMs(delivery.attempts)),
          lastHttpStatus: response.statusCode,
          lastErrorCode: httpError.code,
        });
        logger.warn?.({
          event: "integration.webhook.delivery.failed",
          deliveryId: delivery.id,
          attempt: delivery.attempts,
          httpStatus: response.statusCode,
          terminal: !httpError.retryable || delivery.attempts >= maxAttempts,
          durationMs: Date.now() - startedAt,
        }, "Webhook endpoint rejected delivery");
        return {
          id: delivery.id,
          status: httpError.retryable && delivery.attempts < maxAttempts ? "PENDING" : "DEAD",
          httpStatus: response.statusCode,
        };
      }

      await finish(delivery, {
        status: "SUCCEEDED",
        deliveredAt: clock(),
        lastHttpStatus: response.statusCode,
        lastErrorCode: null,
      });
      logger.info?.({
        event: "integration.webhook.delivery.succeeded",
        deliveryId: delivery.id,
        attempt: delivery.attempts,
        httpStatus: response.statusCode,
        durationMs: Date.now() - startedAt,
      }, "Webhook delivery accepted");
      return { id: delivery.id, status: "SUCCEEDED", httpStatus: response.statusCode };
    } catch (error) {
      const retryable = error?.retryable !== false;
      const terminal = !retryable || delivery.attempts >= maxAttempts;
      const code = typeof error?.code === "string" ? error.code.slice(0, 80) : "WEBHOOK_DELIVERY_FAILED";
      await finish(delivery, {
        status: terminal ? "DEAD" : "PENDING",
        availableAt: new Date(clock().getTime() + retryDelayMs(delivery.attempts)),
        lastHttpStatus: error?.statusCode ?? null,
        lastErrorCode: code,
      });
      logger.error?.({
        event: "integration.webhook.delivery.failed",
        deliveryId: delivery.id,
        attempt: delivery.attempts,
        terminal,
        errorName: error?.name,
        errorCode: code,
        durationMs: Date.now() - startedAt,
      }, terminal ? "Webhook delivery moved to dead-letter state" : "Webhook delivery retry scheduled");
      return { id: delivery.id, status: terminal ? "DEAD" : "PENDING", errorCode: code };
    }
  }

  return Object.freeze({
    workerId,
    async runOnce() {
      const deliveries = await claimDeliveries();
      const results = [];
      for (const delivery of deliveries) results.push(await processDelivery(delivery));
      return results;
    },
  });
}
