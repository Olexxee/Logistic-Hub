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

  async function paystackGet(path) {
    const response = await fetchImpl(`https://api.paystack.co${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}` },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.status) {
      const error = new Error("The payment provider could not complete the request.");
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
        if (["SUCCEEDED", "FAILED", "ABANDONED", "REVERSED"].includes(existing.status)) {
          return { reference: existing.providerReference, status: existing.status, replay: true };
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

    async requestRefund({ bookingType, bookingId, user, idempotencyKey, reason }) {
      const stableKey = createHash("sha256").update(`${user.id}:${idempotencyKey}`).digest("hex");
      const result = await db.createRefundRequest({
        bookingType,
        bookingId,
        userId: user.id,
        idempotencyKey: stableKey,
        reason,
        now: clock(),
      });
      return {
        id: result.refund.id,
        status: result.refund.status,
        amountMinor: result.refund.amountMinor.toString(),
        currency: result.refund.currency,
        replay: result.replay,
      };
    },

    async requestRefund({ refundId, actor }) {
      if (!config.PAYMENTS_ENABLED || !config.PAYSTACK_SECRET_KEY?.trim()) throw new ServiceUnavailableError("Refund processing is disabled for this environment.");
      const refund = await db.findRefundById(refundId);
      if (!refund) throw new ConflictError("The refund request was not found.", "REFUND_NOT_FOUND");
      if (actor.role !== "ADMIN") throw new UnauthorizedError("Only an administrator can process refunds.");
      if (refund.status !== "REQUESTED") throw new ConflictError("Only requested refunds can be processed.", "REFUND_STATE_CONFLICT");
      if (!refund.paymentAttempt.providerReference) throw new ConflictError("The original provider transaction reference is missing.", "PAYMENT_REFERENCE_MISSING");
      const amount = Number(refund.amountMinor);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ConflictError("The refund amount is outside the supported range.", "REFUND_AMOUNT_INVALID");
      const data = await paystackRequest("/refund", {
        transaction: refund.paymentAttempt.providerReference,
        amount,
        customer_note: refund.reason.slice(0, 500),
        merchant_note: `Logistic Hub refund ${refund.id}`,
      });
      const providerReference = String(data.id ?? "");
      if (!providerReference) throw new ConflictError("The provider did not return a refund reference.", "REFUND_REFERENCE_MISSING");
      const updated = await db.markRefundProcessing({
        id: refund.id,
        providerReference,
        providerPayload: { status: data.status ?? "pending", id: providerReference, transaction: refund.paymentAttempt.providerReference },
      });
      return { id: updated.id, status: updated.status, providerReference };
    },

    async requestPayout({ bookingType, bookingId, user, idempotencyKey }) {
      if (!config.PAYMENTS_ENABLED || !config.PAYSTACK_SECRET_KEY?.trim()) throw new ServiceUnavailableError("Payout processing is disabled for this environment.");
      const stableKey = createHash("sha256").update(`${user.id}:${idempotencyKey}`).digest("hex");
      const reference = `LH-TRF-${randomBytes(10).toString("hex").toUpperCase()}`;
      const prepared = await db.createPayoutRequest({ bookingType, bookingId, userId: user.id, idempotencyKey: stableKey, reference });
      if (prepared.replay) return { id: prepared.payout.id, status: prepared.payout.status, reference: prepared.payout.providerReference, replay: true };
      const amount = Number(prepared.payout.amountMinor);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        await db.updatePayout({ id: prepared.payout.id, status: "FAILED", failureReason: "PAYOUT_AMOUNT_INVALID", providerPayload: { code: "PAYOUT_AMOUNT_INVALID" }, processedAt: clock() });
        throw new ConflictError("The payout amount is outside the supported range.", "PAYOUT_AMOUNT_INVALID");
      }
      try {
        const data = await paystackRequest("/transfer", {
          source: "balance",
          amount,
          recipient: prepared.recipientCode,
          reference,
          reason: `Logistic Hub driver payout for ${bookingType} ${bookingId}`,
        });
        const updated = await db.updatePayout({
          id: prepared.payout.id,
          status: "PROCESSING",
          providerPayload: { status: data.status ?? "pending", transferCode: data.transfer_code ?? null, reference },
        });
        return { id: updated.id, status: updated.status, reference, replay: false };
      } catch (error) {
        await db.updatePayout({ id: prepared.payout.id, status: "PENDING", failureReason: "PROVIDER_RESPONSE_UNKNOWN", providerPayload: { code: error.code ?? "PAYMENT_PROVIDER_FAILED", reconciliationRequired: true } });
        throw error;
      }
    },

    async listRefunds(input) {
      const rows = await db.listRefunds(input);
      const hasMore = rows.length > input.limit;
      const data = hasMore ? rows.slice(0, input.limit) : rows;
      return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
    },

    async listPayouts(input) {
      const rows = await db.listPayouts(input);
      const hasMore = rows.length > input.limit;
      const data = hasMore ? rows.slice(0, input.limit) : rows;
      return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
    },

    async reconcilePayment(reference) {
      if (!config.PAYMENTS_ENABLED || !config.PAYSTACK_SECRET_KEY?.trim()) throw new ServiceUnavailableError("Payment reconciliation is disabled for this environment.");
      const local = await db.findAttemptByReference(reference);
      if (!local) throw new ConflictError("The local payment reference was not found.", "PAYMENT_NOT_FOUND");
      const remote = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`);
      const providerStatus = String(remote.status ?? "unknown").toUpperCase();
      const amountMatches = Number.isSafeInteger(remote.amount) && BigInt(remote.amount) === local.amountMinor;
      const currencyMatches = String(remote.currency ?? "") === local.currency;
      const statusMatches = providerStatus === "SUCCESS" ? local.status === "SUCCEEDED" : providerStatus === local.status;
      return {
        reference,
        local: { status: local.status, amountMinor: local.amountMinor.toString(), currency: local.currency },
        provider: { status: providerStatus, amountMinor: remote.amount == null ? null : String(remote.amount), currency: remote.currency ?? null },
        matches: { amount: amountMatches, currency: currencyMatches, status: statusMatches },
        reconciled: amountMatches && currencyMatches && statusMatches,
        checkedAt: clock(),
      };
    },

    async handleWebhook({ rawBody, signature, event }) {
      if (!config.PAYMENTS_ENABLED || !config.PAYSTACK_SECRET_KEY?.trim()) {
        throw new ServiceUnavailableError("Payment webhooks are disabled for this environment.");
      }
      if (!signatureMatches(rawBody, signature, config.PAYSTACK_SECRET_KEY)) {
        throw new UnauthorizedError("The Paystack webhook signature is invalid.");
      }
      const data = event?.data;
      if (!data || typeof event?.event !== "string") {
        throw new ConflictError("The payment webhook payload is invalid.", "PAYMENT_WEBHOOK_INVALID");
      }
      if (event.event === "charge.success") {
        if (data.status !== "success" || !Number.isSafeInteger(data.amount) || data.amount < 1) {
          throw new ConflictError("The successful payment webhook payload is invalid.", "PAYMENT_WEBHOOK_INVALID");
        }
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
        if (typeof data.reference !== "string") throw new ConflictError("The payment webhook reference is invalid.", "PAYMENT_WEBHOOK_INVALID");
        return db.processFailedWebhook({
          reference: data.reference,
          payload: { event: event.event, reference: data.reference, status: data.status },
          now: clock(),
        });
      }
      if (event.event === "refund.processed" || event.event === "refund.failed") {
        if (data.id == null) throw new ConflictError("The refund webhook reference is invalid.", "PAYMENT_WEBHOOK_INVALID");
        return db.settleRefund({
          providerReference: String(data.id),
          payload: { event: event.event, id: String(data.id), status: data.status ?? null },
          now: clock(),
          succeeded: event.event === "refund.processed" && ["processed", "success", "successful"].includes(String(data.status ?? "processed").toLowerCase()),
        });
      }
      if (event.event === "transfer.success" || event.event === "transfer.failed") {
        if (typeof data.reference !== "string" || !Number.isSafeInteger(data.amount)) throw new ConflictError("The transfer webhook payload is invalid.", "PAYMENT_WEBHOOK_INVALID");
        return db.settlePayoutWebhook({
          reference: data.reference,
          amountMinor: BigInt(data.amount),
          payload: { event: event.event, reference: data.reference, status: data.status ?? null },
          now: clock(),
          succeeded: event.event === "transfer.success",
        });
      }
      return { ignored: true, event: String(event.event ?? "unknown") };
    },
  };
}
