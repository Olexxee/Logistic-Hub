import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { createPaymentsRepository } from "./payments.repository.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { ServiceUnavailableError, ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/app-error.js";

export function createPaymentsService({ prismaClient, repository = createPaymentsRepository(prismaClient), notifications = createNotificationsService({ prismaClient }), secretKey = env.PAYSTACK_SECRET_KEY, enabled = env.PAYMENTS_ENABLED, refundsEnabled = env.REFUNDS_ENABLED, fetchImpl = fetch, clock = () => new Date() } = {}) {
  return {

    async createRefundRequest({ bookingType, bookingId, reason, user, idempotencyKey }) {
      if (!["CUSTOMER", "ADMIN", "SUPPORT"].includes(user?.role)) throw new ForbiddenError();
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw new ConflictError("A valid Idempotency-Key header is required.", "IDEMPOTENCY_KEY_REQUIRED");
      }
      const normalizedType = bookingType === "PARCEL_DELIVERY" ? "PARCEL" : "RIDE";
      const result = await repository.createRefundRequest({
        bookingType: normalizedType, bookingId, userId: user.id, reason, idempotencyKey,
        publicReference: "RF-" + createHash("sha256").update(user.id + ":" + idempotencyKey).digest("hex").slice(0, 16).toUpperCase(),
        now: clock(),
      });
      if (result.notFound) throw new NotFoundError("Booking not found or not owned by this account.", "BOOKING_NOT_FOUND");
      if (result.conflict === "IDEMPOTENCY_CONFLICT") throw new ConflictError("The idempotency key was already used for a different refund request.", "IDEMPOTENCY_CONFLICT");
      if (result.conflict === "PAYMENT_NOT_CAPTURED") throw new ConflictError("A refund can only be requested for a successfully captured payment.", "PAYMENT_NOT_CAPTURED");
      if (result.conflict === "PAYMENT_REFERENCE_MISSING") throw new ConflictError("The captured payment has no provider reference; support must investigate it.", "PAYMENT_REFERENCE_MISSING");
      if (result.conflict === "NO_REFUNDABLE_BALANCE") throw new ConflictError("There is no remaining refundable balance for this payment.", "NO_REFUNDABLE_BALANCE");
      return { ...result.refund, amountMinor: result.refund.amountMinor.toString(), replay: result.replay };
    },
    async listRefunds({ status, cursor, limit = 50 } = {}) {
      const rows = await repository.listRefunds({ status, cursor, limit });
      const hasMore = rows.length > limit;
      const data = (hasMore ? rows.slice(0, limit) : rows).map(refund => ({
        ...refund, amountMinor: refund.amountMinor.toString(),
      }));
      return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
    },
    async processRefund({ refundId, actor }) {
      if (actor?.role !== "ADMIN") throw new ForbiddenError("Only an administrator can approve and submit a refund.");
      if (!refundsEnabled) throw new ServiceUnavailableError("Provider refund processing is disabled. Refund requests can be reviewed, but no money will be moved until REFUNDS_ENABLED is explicitly approved.", "REFUNDS_DISABLED");
      if (!secretKey) throw new ServiceUnavailableError("Paystack is not configured.", "PAYSTACK_NOT_CONFIGURED");
      const prepared = await repository.prepareRefundProcessing({ refundId, actorUserId: actor.id, now: clock() });
      if (prepared.notFound) throw new NotFoundError("Refund request not found.", "REFUND_NOT_FOUND");
      if (prepared.conflict) throw new ConflictError("This refund request cannot be processed from its current state: " + prepared.conflict + ".", "REFUND_NOT_PROCESSABLE");
      if (prepared.outcomeUnknown) throw new ConflictError("The previous provider submission has an unknown outcome. Reconcile it in Paystack before taking further action; do not resubmit.", "REFUND_SUBMISSION_OUTCOME_UNKNOWN");
      if (prepared.replay) return { ...prepared.refund, amountMinor: prepared.refund.amountMinor.toString(), replay: true };
      const refund = prepared.refund;
      if (refund.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ConflictError("Refund amount exceeds the provider's safe integer range.", "INVALID_REFUND_AMOUNT");
      let response;
      try {
        response = await fetchImpl("https://api.paystack.co/refund", {
          method: "POST",
          headers: { Authorization: "Bearer " + secretKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction: refund.paymentAttempt.providerReference,
            amount: Number(refund.amountMinor),
            customer_note: refund.reason,
            merchant_note: "Logistic Hub refund " + refund.publicReference,
          }),
        });
      } catch {
        await repository.markRefundSubmissionUnknown({ refundId, actorUserId: actor.id });
        throw new ServiceUnavailableError("Paystack's response could not be confirmed. The refund remains locked for reconciliation; do not submit it again.", "REFUND_SUBMISSION_OUTCOME_UNKNOWN");
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.status || !body?.data) {
        const providerResponse = {
          status: body?.status === true,
          message: typeof body?.message === "string" ? body.message.slice(0, 300) : "Provider rejected the refund request.",
          providerStatusCode: response.status,
        };
        await repository.saveRefundProviderResult({ refundId, providerResponse, failed: true, actorUserId: actor.id });
        throw new ServiceUnavailableError("Paystack rejected the refund submission. The request is marked failed and requires review before another attempt.", "REFUND_PROVIDER_REJECTED");
      }
      const providerReference = body.data.id != null ? String(body.data.id) : (body.data.reference != null ? String(body.data.reference) : null);
      if (!providerReference) {
        await repository.markRefundSubmissionUnknown({ refundId, actorUserId: actor.id });
        throw new ServiceUnavailableError("Paystack accepted the request without returning a refund identifier. Reconciliation is required; do not resubmit.", "REFUND_SUBMISSION_OUTCOME_UNKNOWN");
      }
      const providerResponse = {
        status: true, message: typeof body.message === "string" ? body.message.slice(0, 300) : "Refund accepted by provider.",
        providerStatus: body.data.status ?? null, amount: body.data.amount ?? null, currency: body.data.currency ?? refund.currency,
      };
      const saved = await repository.saveRefundProviderResult({ refundId, providerReference, providerResponse, actorUserId: actor.id });
      return { ...saved, amountMinor: saved.amountMinor.toString(), replay: false };
    },
    async initialize({ bookingType, bookingId, userId, idempotencyKey }) {
      if (!enabled) throw new ServiceUnavailableError("Online payments are disabled until the project owner approves activation.", "PAYMENTS_DISABLED");
      if (!secretKey) throw new ServiceUnavailableError("Paystack is not configured.", "PAYSTACK_NOT_CONFIGURED");
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) throw new ConflictError("A valid Idempotency-Key header is required.", "IDEMPOTENCY_KEY_REQUIRED");
      const booking = await repository.findBooking({ bookingType, bookingId, userId });
      if (!booking) throw new ConflictError("Booking was not found or is not owned by the authenticated user.", "BOOKING_NOT_PAYABLE");
      const assignment = booking.assignments?.[0];
      if (booking.status !== "AWAITING_PAYMENT" || !assignment || booking.paymentStatus === "SUCCEEDED") throw new ConflictError("This booking is not awaiting payment.", "BOOKING_NOT_PAYABLE");
      const amountMinor = booking.customerPayableMinor;
      if (amountMinor == null || amountMinor <= 0n || assignment.agreedFareMinor > amountMinor || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new ConflictError("The payable amount is invalid.", "INVALID_PAYMENT_AMOUNT");
      const settlement = assignment.driverProfile?.settlementAccounts?.[0];
      if (!settlement?.externalAccountRef || settlement.status !== "ACTIVE") throw new ConflictError("The assigned driver has no active Paystack settlement subaccount.", "DRIVER_SETTLEMENT_NOT_READY");
      const platformFeeMinor = amountMinor - assignment.agreedFareMinor;
      const reference = ("lh_" + bookingType.toLowerCase() + "_" + booking.id + "_" + idempotencyKey).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
      const attempt = await repository.createAttempt({
        ...(bookingType === "PARCEL" ? { parcelBookingId: booking.id } : { rideBookingId: booking.id }),
        provider: "PAYSTACK", providerReference: reference, idempotencyKey, status: "INITIALIZED",
        amountMinor, currency: booking.currency, driverAllocationMinor: assignment.agreedFareMinor,
        platformAllocationMinor: platformFeeMinor, driverSettlementAccountId: settlement.id,
        splitConfigurationSnapshot: { subaccount: settlement.externalAccountRef, transactionChargeMinor: platformFeeMinor.toString(), platformFeeModel: "FIXED_CONNECTION_FEE" },
      });
      if (attempt.amountMinor !== amountMinor || attempt.parcelBookingId !== (bookingType === "PARCEL" ? booking.id : null) || attempt.rideBookingId !== (bookingType === "RIDE" ? booking.id : null)) throw new ConflictError("The idempotency key was previously used for a different payment.", "IDEMPOTENCY_CONFLICT");
      if (attempt.providerPayload?.authorizationUrl) return { paymentAttemptId: attempt.id, reference: attempt.providerReference, authorizationUrl: attempt.providerPayload.authorizationUrl, accessCode: attempt.providerPayload.accessCode ?? null, amountMinor: amountMinor.toString(), currency: booking.currency, replay: true };
      const user = await repository.findUserEmail(userId);
      if (!user?.email) throw new ConflictError("A verified email address is required for payment.", "PAYMENT_EMAIL_REQUIRED");
      const response = await fetchImpl("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: "Bearer " + secretKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, amount: Number(amountMinor), currency: booking.currency, reference: attempt.providerReference, subaccount: settlement.externalAccountRef, transaction_charge: Number(platformFeeMinor), metadata: { bookingType, bookingId: booking.id, paymentAttemptId: attempt.id } }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.status || !body?.data?.authorization_url) throw new ServiceUnavailableError("Paystack could not initialize this payment. Retry with the same idempotency key.", "PAYSTACK_INITIALIZATION_FAILED");
      await repository.saveAuthorization({ id: attempt.id, authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code });
      return { paymentAttemptId: attempt.id, reference: attempt.providerReference, authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code, amountMinor: amountMinor.toString(), currency: booking.currency, replay: false };
    },
    verifySignature(rawBody, signature) {
      if (!secretKey || typeof signature !== "string" || !rawBody) return false;
      const expected = createHmac("sha512", secretKey).update(rawBody).digest();
      let supplied;
      try { supplied = Buffer.from(signature, "hex"); } catch { return false; }
      return supplied.length === expected.length && timingSafeEqual(expected, supplied);
    },
    async handleWebhook({ payload, rawBody, signature }) {
      const isRefundEvent = payload.event === "refund.processed" || payload.event === "refund.failed";
      if (isRefundEvent && !refundsEnabled) throw new ServiceUnavailableError("Paystack refund webhook processing is disabled until refund activation is approved.", "REFUNDS_DISABLED");
      if (!isRefundEvent && !enabled) throw new ServiceUnavailableError("Paystack webhook processing is disabled until payment activation is approved.", "PAYMENTS_DISABLED");
      if (!this.verifySignature(rawBody, signature)) throw Object.assign(new Error("Invalid Paystack signature."), { statusCode: 401, code: "INVALID_WEBHOOK_SIGNATURE" });
      if (payload.event === "refund.processed" || payload.event === "refund.failed") {
        const status = payload.event === "refund.processed" ? "PROCESSED" : "FAILED";
        const providerReference = String(payload.data?.id ?? payload.data?.reference ?? "");
        if (!providerReference) return { accepted: true, ignored: true };
        const updated = await repository.updateRefundFromWebhook({ providerReference, status, providerResponse: { event: payload.event, id: providerReference } });
        return { accepted: true, updatedCount: updated.count };
      }
      if (payload.event === "charge.failed" && payload.data?.reference) {
        const reference = payload.data.reference;
        return repository.markFailed({
          reference,
          providerEventId: String(payload.data.id ?? reference),
          eventType: payload.event,
          payloadHash: createHash("sha256").update(rawBody).digest("hex"),
          providerPayload: { event: payload.event, reference, status: payload.data.status ?? "failed" },
        });
      }
      if (payload.event !== "charge.success" || payload.data?.status !== "success") return { accepted: true, ignored: true };
      const reference = payload.data.reference;
      const response = await fetchImpl("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), { headers: { Authorization: "Bearer " + secretKey } });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.status || body.data?.status !== "success") throw new ConflictError("Paystack transaction verification did not confirm success.", "PAYSTACK_TRANSACTION_UNVERIFIED");
      const providerEventId = String(payload.data.id ?? reference);
      const result = await repository.settle({
        reference, amountMinor: body.data.amount, currency: body.data.currency,
        providerPayload: { event: payload.event, reference, transactionId: providerEventId, channel: body.data.channel },
        providerEventId, eventType: payload.event,
        payloadHash: createHash("sha256").update(rawBody).digest("hex"),
      });
      if (result.status === "settled" && result.userId) {
        await notifications.createAndDeliver({
          userId: result.userId, type: "PAYMENT_CONFIRMED", title: "Payment confirmed",
          body: "Payment for booking " + result.publicReference + " was confirmed. Your assigned driver can now proceed.",
          data: { bookingType: result.bookingType, bookingId: result.bookingId, reference },
          deliveryKey: "payment-confirmed-" + reference, emailSubject: "Your Logistic Hub payment is confirmed",
        });
      }
      return result;
    },
  };
}
