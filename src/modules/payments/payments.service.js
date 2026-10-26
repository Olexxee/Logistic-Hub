import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { ConflictError, ForbiddenError, ServiceUnavailableError, NotFoundError } from "../../shared/http/app-error.js";
import { createPaymentsRepository } from "./payments.repository.js";
import { createPaystackProvider } from "./paystack.provider.js";

export function createPaymentsService({ prismaClient, provider = createPaystackProvider({ secretKey: env.PAYSTACK_SECRET_KEY }), paymentsEnabled = env.PAYMENTS_ENABLED, appBaseUrl = env.APP_BASE_URL }) {
  const repository = createPaymentsRepository({ prismaClient });
  return {
    async initialize({ user, type, bookingId, idempotencyKey }) {
      if (!paymentsEnabled) throw new ServiceUnavailableError("Online payments are not enabled for this deployment.", "PAYMENTS_DISABLED");
      if (!idempotencyKey || idempotencyKey.length > 128) throw new ConflictError("An Idempotency-Key header is required.", "IDEMPOTENCY_KEY_REQUIRED");
      const booking = await repository.findBooking({ type, bookingId });
      if (!booking) throw new NotFoundError("Booking not found.");
      const owner = type === "RIDE" ? booking.passenger : booking.sender;
      if (owner?.id !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) throw new ForbiddenError("You cannot pay for this booking.");
      if (booking.status !== "AWAITING_PAYMENT" || booking.paymentStatus === "SUCCEEDED" || booking.customerPayableMinor == null) {
        throw new ConflictError("This booking is not ready for payment.", "BOOKING_NOT_PAYABLE");
      }
      const assignment = booking.assignments?.[0];
      const settlement = assignment?.driverProfile?.settlementAccounts?.find((item) => item.provider === "PAYSTACK" && item.status === "ACTIVE" && item.currency === booking.currency);
      if (!assignment || !settlement) throw new ConflictError("The assigned driver has no active verified Paystack settlement account.", "DRIVER_SETTLEMENT_UNAVAILABLE");
      const amountMinor = BigInt(booking.customerPayableMinor);
      const driverFareMinor = BigInt(booking.driverFareMinor);
      const platformAmountMinor = amountMinor - driverFareMinor;
      if (amountMinor <= 0n || driverFareMinor <= 0n || platformAmountMinor < 0n) throw new ConflictError("The booking price snapshot is invalid.", "INVALID_BOOKING_PRICE");
      const key = `${user.id}:${idempotencyKey}`;
      const replay = await repository.findAttemptByIdempotencyKey(key);
      if (replay) {
        if ((type === "RIDE" ? replay.rideBookingId : replay.parcelBookingId) !== bookingId) throw new ConflictError("The idempotency key was reused for another booking.", "IDEMPOTENCY_KEY_CONFLICT");
        if (replay.providerPayload?.authorization_url) return { authorizationUrl: replay.providerPayload.authorization_url, reference: replay.providerReference, replay: true };
        throw new ConflictError("This payment attempt already exists and is not reusable.", "PAYMENT_ATTEMPT_EXISTS");
      }
      const reference = `LH_${randomUUID().replaceAll("-", "")}`;
      const attempt = await repository.createAttempt({
        ...(type === "RIDE" ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
        provider: "PAYSTACK", providerReference: reference, idempotencyKey: key, status: "INITIALIZED",
        amountMinor, currency: booking.currency, driverAllocationMinor: driverFareMinor,
        platformAllocationMinor: platformAmountMinor, driverSettlementAccountId: settlement.id,
        splitConfigurationSnapshot: { driverProfileId: assignment.driverProfile.id, settlementAccountId: settlement.id, driverAllocationMinor: driverFareMinor.toString(), platformAllocationMinor: platformAmountMinor.toString(), model: "paystack-subaccount-fixed-transaction-charge" },
      });
      try {
        const initialized = await provider.initializeTransaction({
          email: owner.email,
          amount: Number(amountMinor),
          currency: booking.currency,
          reference,
          callback_url: new URL("/payment/return", appBaseUrl).toString(),
          subaccount: settlement.externalAccountRef,
          transaction_charge: Number(platformAmountMinor),
          bearer: "subaccount",
          metadata: { paymentAttemptId: attempt.id, bookingType: type, bookingId, publicReference: booking.publicReference },
        });
        await repository.updateAttempt(attempt.id, { status: "PENDING", providerPayload: { authorization_url: initialized.authorization_url, access_code: initialized.access_code } });
        return { authorizationUrl: initialized.authorization_url, reference, amountMinor: amountMinor.toString(), currency: booking.currency, replay: false };
      } catch (error) {
        await repository.updateAttempt(attempt.id, { status: "FAILED", failedAt: new Date(), providerPayload: { failureCode: error.code ?? "PAYSTACK_INITIALIZATION_FAILED" } });
        throw error;
      }
    },
    async handleWebhook({ rawBody, signature, payload }) {
      if (!paymentsEnabled) throw new ServiceUnavailableError("Payment webhooks are disabled for this deployment.", "PAYMENTS_DISABLED");
      if (!provider.verifyWebhookSignature(rawBody, signature)) throw new ForbiddenError("Invalid Paystack webhook signature.");
      if (payload?.event !== "charge.success" || typeof payload?.data?.reference !== "string") return { ignored: true };
      const attempt = await repository.findAttemptByReference(payload.data.reference);
      if (!attempt) return { ignored: true };
      const verified = await provider.verifyTransaction(payload.data.reference);
      const expectedAmount = Number(attempt.amountMinor);
      if (verified.amount !== expectedAmount || verified.currency !== attempt.currency || verified.status !== "success") {
        await repository.updateAttempt(attempt.id, { status: "FAILED", failedAt: new Date() });
        return { accepted: false, reason: "PAYMENT_MISMATCH" };
      }
      return repository.settle({ attempt, verified });
    },
  };
}
