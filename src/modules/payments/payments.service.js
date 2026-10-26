import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { ServiceUnavailableError, ConflictError, UnauthorizedError } from "../../shared/http/app-error.js";
import { createPaymentsRepository } from "./payments.repository.js";

function safeProviderPayload(data) {
  return {
    reference: data.reference,
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
  };
}
function signatureMatches(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function createPaymentsService({ prismaClient, repository, config = env, fetchImpl = fetch, clock = () => new Date() }) {
  const db = repository ?? createPaymentsRepository({ prismaClient });

  async function paystackRequest(path, body) {
    const response = await fetchImpl(`https://api.paystack.co${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.status) {
      const error = new Error("The payment provider could not process the request.");
      error.statusCode = 502;
      error.code = "PAYMENT_PROVIDER_FAILED";
      throw error;
    }
    return data.data;
  }

  return {
    async initialize({ serviceType, bookingId, user, idempotencyKey }) {
      if (!config.PAYMENTS_ENABLED || !config.PAYSTACK_SECRET_KEY?.trim()) {
        throw new ServiceUnavailableError("Payments are not enabled for this environment.");
      }
      if (!["PASSENGER_RIDE", "PARCEL_DELIVERY"].includes(serviceType)) {
        throw new ConflictError("The requested payment service type is invalid.", "PAYMENT_SERVICE_INVALID");
      }
      const stableKey = createHash("sha256").update(`${user.id}:${idempotencyKey}`).digest("hex");
      const existing = await db.findAttemptByIdempotencyKey(stableKey);
      if (existing) {
        const owner = existing.rideBooking?.passengerId ?? existing.parcelBooking?.senderId;
        if (owner !== user.id) throw new ConflictError("The idempotency key belongs to another account.", "IDEMPOTENCY_CONFLICT");
        if (existing.providerPayload?.authorizationUrl) {
          return { reference: existing.providerReference, authorizationUrl: existing.providerPayload.authorizationUrl, status: existing.status, replay: true };
        }
        throw new ConflictError("This payment attempt is already being processed.", "PAYMENT_ALREADY_PENDING");
      }
      const reference = `LH-${randomBytes(12).toString("hex").toUpperCase()}`;
      const prepared = await db.prepareAttempt({
        serviceType,
        bookingId,
        userId: user.id,
        idempotencyKey: stableKey,
        reference,
        now: clock(),
      });
      const amount = Number(prepared.attempt.amountMinor);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        await db.updateInitialization({ id: prepared.attempt.id, status: "FAILED", providerPayload: { code: "AMOUNT_OUT_OF_RANGE" }, failedAt: clock() });
        throw new ConflictError("The payment amount is outside the supported range.", "PAYMENT_AMOUNT_INVALID");
      }
      try {
        const data = await paystackRequest("/transaction/initialize", {
          email: user.email,
          amount,
          currency: prepared.attempt.currency,
          reference,
          callback_url: config.PAYSTACK_CALLBACK_URL,
          metadata: {
            paymentAttemptId: prepared.attempt.id,
            serviceType,
            bookingId,
            customerId: user.id,
            driverAllocationMinor: prepared.attempt.driverAllocationMinor.toString(),
            platformConnectionFeeMinor: prepared.attempt.platformAllocationMinor.toString(),
          },
        });
        await db.updateInitialization({ id: prepared.attempt.id, status: "PENDING", providerPayload: safeProviderPayload(data) });
        return { reference, authorizationUrl: data.authorization_url, status: "PENDING", replay: false };
      } catch (error) {
        await db.updateInitialization({
          id: prepared.attempt.id,
          status: "FAILED",
          providerPayload: { code: error.code ?? "PAYMENT_PROVIDER_FAILED" },
          failedAt: clock(),
        });
        throw error;
      }
    },

    async handleWebhook({ rawBody, signature, event }) {
      if (!config.PAYMENTS_ENABLED || !config.PAYSTACK_SECRET_KEY?.trim()) {
        throw new ServiceUnavailableError("Payment webhooks are disabled for this environment.");
      }
      if (!signatureMatches(rawBody, signature, config.PAYSTACK_SECRET_KEY)) {
        throw new UnauthorizedError("The Paystack webhook signature is invalid.");
      }
      const data = event?.data;
      if (!data || typeof data.reference !== "string") {
        throw new ConflictError("The payment webhook payload is invalid.", "PAYMENT_WEBHOOK_INVALID");
      }
      if (event.event === "charge.success") {
        const amountMinor = BigInt(data.amount);
        const fee = data.fees == null ? 0n : BigInt(data.fees);
        return db.processSuccessfulWebhook({
          reference: data.reference,
          amountMinor,
          currency: String(data.currency ?? ""),
          providerFeeMinor: fee,
          payload: { event: event.event, reference: data.reference, status: data.status, fees: data.fees ?? null },
          now: clock(),
        });
      }
      if (event.event === "charge.failed") {
        return db.processFailedWebhook({
          reference: data.reference,
          payload: { event: event.event, reference: data.reference, status: data.status },
          now: clock(),
        });
      }
      return { ignored: true, event: String(event.event ?? "unknown") };
    },
  };
}
