import { ConflictError, NotFoundError } from "../../shared/http/app-error.js";

function conflict(message, code = "PAYMENT_STATE_CONFLICT") { return new ConflictError(message, code); }

export function createPaymentsRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    findAttemptByIdempotencyKey(idempotencyKey) {
      return prismaClient.paymentAttempt.findUnique({
        where: { idempotencyKey },
        include: { rideBooking: { select: { passengerId: true } }, parcelBooking: { select: { senderId: true } } },
      });
    },
    async prepareAttempt({ serviceType, bookingId, userId, idempotencyKey, reference, now }) {
      return prismaClient.$transaction(async (tx) => {
        const isRide = serviceType === "PASSENGER_RIDE";
        const booking = isRide
          ? await tx.rideBooking.findUnique({
              where: { id: bookingId },
              include: { assignments: { where: { status: "AWAITING_PAYMENT" }, orderBy: { reservedAt: "desc" }, take: 1, include: { driverProfile: { select: { id: true } } } } },
            })
          : await tx.parcelBooking.findUnique({
              where: { id: bookingId },
              include: { assignments: { where: { status: "AWAITING_PAYMENT" }, orderBy: { reservedAt: "desc" }, take: 1, include: { driverProfile: { select: { id: true } } } } },
            });
        if (!booking) throw new NotFoundError("The booking was not found.");
        const ownerId = isRide ? booking.passengerId : booking.senderId;
        if (ownerId !== userId) throw new ConflictError("You cannot pay for this booking.", "BOOKING_ACCESS_DENIED");
        if (booking.status !== "AWAITING_PAYMENT" || !["INITIALIZED", "FAILED", "ABANDONED"].includes(booking.paymentStatus)) {
          throw conflict("The booking is not ready for payment.");
        }
        const assignment = booking.assignments[0];
        if (!assignment) throw conflict("A driver fare must be accepted before payment can be initialized.", "ASSIGNMENT_NOT_RESERVED");
        if (booking.driverFareMinor == null || booking.customerPayableMinor == null) {
          throw conflict("The accepted fare is missing.", "FARE_NOT_ACCEPTED");
        }
        const expected = booking.driverFareMinor + booking.connectionFeeMinor;
        if (expected !== booking.customerPayableMinor || expected <= 0n) {
          throw conflict("The payable amount does not match the accepted fare and connection fee.", "PAYMENT_AMOUNT_INVALID");
        }
        const pending = await tx.paymentAttempt.findFirst({
          where: {
            status: { in: ["INITIALIZED", "PENDING"] },
            ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
          },
        });
        if (pending) throw conflict("A payment attempt is already in progress.", "PAYMENT_ALREADY_PENDING");
        const amount = booking.customerPayableMinor;
        const attempt = await tx.paymentAttempt.create({
          data: {
            ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
            provider: "PAYSTACK",
            providerReference: reference,
            idempotencyKey,
            status: "INITIALIZED",
            amountMinor: amount,
            currency: booking.currency,
            driverAllocationMinor: booking.driverFareMinor,
            platformAllocationMinor: booking.connectionFeeMinor,
            splitConfigurationSnapshot: {
              model: "PLATFORM_COLLECTION_NO_PROVIDER_SPLIT",
              driverAllocationMinor: booking.driverFareMinor.toString(),
              platformConnectionFeeMinor: booking.connectionFeeMinor.toString(),
              note: "Paystack split/escrow is not used; driver funds remain a platform liability until payout.",
            },
          },
        });
        if (isRide) {
          await tx.rideBooking.update({ where: { id: bookingId }, data: { status: "PAYMENT_PENDING", paymentStatus: "PENDING" } });
        } else {
          await tx.parcelBooking.update({ where: { id: bookingId }, data: { status: "PAYMENT_PENDING", paymentStatus: "PENDING" } });
        }
        await tx.bookingEvent.create({
          data: {
            ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
            actorUserId: userId,
            eventType: "PAYMENT_INITIALIZATION_STARTED",
            fromStatus: "AWAITING_PAYMENT",
            toStatus: "PAYMENT_PENDING",
            metadata: { paymentAttemptId: attempt.id, amountMinor: amount.toString(), currency: booking.currency },
          },
        });
        return { attempt, booking, ownerId };
      });
    },
    updateInitialization({ id, status, providerPayload, failedAt }) {
      return prismaClient.paymentAttempt.update({
        where: { id },
        data: { status, providerPayload, ...(failedAt ? { failedAt } : {}) },
      });
    },
    async processSuccessfulWebhook({ reference, amountMinor, currency, providerFeeMinor, payload, now }) {
      return prismaClient.$transaction(async (tx) => {
        const attempt = await tx.paymentAttempt.findUnique({
          where: { providerReference: reference },
          include: {
            rideBooking: true,
            parcelBooking: true,
          },
        });
        if (!attempt) throw new NotFoundError("Payment reference was not found.");
        if (attempt.status === "SUCCEEDED") return { duplicate: true, paymentAttemptId: attempt.id };
        if (!["INITIALIZED", "PENDING"].includes(attempt.status)) throw conflict("The payment attempt is not payable.");
        if (attempt.amountMinor !== amountMinor || attempt.currency !== currency) {
          throw conflict("The verified payment amount or currency does not match the booking.", "PAYMENT_AMOUNT_MISMATCH");
        }
        const fee = providerFeeMinor > 0n ? providerFeeMinor : 0n;
        if (fee >= amountMinor) throw conflict("The provider fee is not valid.", "PAYMENT_FEE_INVALID");
        const isRide = Boolean(attempt.rideBookingId);
        const booking = isRide ? attempt.rideBooking : attempt.parcelBooking;
        if (!booking || booking.status !== "PAYMENT_PENDING" || booking.paymentStatus !== "PENDING") {
          throw conflict("The booking is not awaiting this payment.", "BOOKING_PAYMENT_STATE_CONFLICT");
        }
        const assignment = await tx.driverAssignment.findFirst({
          where: {
            status: "AWAITING_PAYMENT",
            ...(isRide ? { rideBookingId: booking.id } : { parcelBookingId: booking.id }),
          },
          include: { driverProfile: { select: { userId: true } } },
          orderBy: { reservedAt: "desc" },
        });
        if (!assignment) throw conflict("The reserved driver assignment was not found.", "ASSIGNMENT_NOT_RESERVED");
        const driverAmount = attempt.driverAllocationMinor ?? 0n;
        const platformAmount = attempt.platformAllocationMinor ?? 0n;
        if (driverAmount + platformAmount !== amountMinor) {
          throw conflict("The ledger allocations do not balance to the verified payment.", "LEDGER_ALLOCATION_MISMATCH");
        }

        const attemptUpdate = await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, status: { in: ["INITIALIZED", "PENDING"] } },
          data: { status: "SUCCEEDED", verifiedAt: now, providerFeeMinor: fee, providerPayload: payload },
        });
        if (attemptUpdate.count !== 1) return { duplicate: true, paymentAttemptId: attempt.id };
        const bookingUpdate = isRide
          ? await tx.rideBooking.updateMany({ where: { id: booking.id, status: "PAYMENT_PENDING", paymentStatus: "PENDING" }, data: { status: "DRIVER_ASSIGNED", paymentStatus: "SUCCEEDED", paidAt: now } })
          : await tx.parcelBooking.updateMany({ where: { id: booking.id, status: "PAYMENT_PENDING", paymentStatus: "PENDING" }, data: { status: "DRIVER_ASSIGNED", paymentStatus: "SUCCEEDED", paidAt: now } });
        if (bookingUpdate.count !== 1) throw conflict("Booking state changed while settling payment.");
        const assignmentUpdate = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: "AWAITING_PAYMENT" },
          data: { status: "ACCEPTED", acceptedAt: now },
        });
        if (assignmentUpdate.count !== 1) throw conflict("Assignment state changed while settling payment.");

        const currencyCode = attempt.currency;
        const accounts = await Promise.all([
          tx.ledgerAccount.upsert({ where: { code: `PAYSTACK_CLEARING_${currencyCode}` }, create: { code: `PAYSTACK_CLEARING_${currencyCode}`, name: "Paystack clearing", type: "ASSET", currency: currencyCode }, update: {} }),
          tx.ledgerAccount.upsert({ where: { code: `DRIVER_PAYABLE_${currencyCode}` }, create: { code: `DRIVER_PAYABLE_${currencyCode}`, name: "Driver payable", type: "LIABILITY", currency: currencyCode }, update: {} }),
          tx.ledgerAccount.upsert({ where: { code: `PLATFORM_CONNECTION_FEE_${currencyCode}` }, create: { code: `PLATFORM_CONNECTION_FEE_${currencyCode}`, name: "Platform connection fee revenue", type: "REVENUE", currency: currencyCode }, update: {} }),
          tx.ledgerAccount.upsert({ where: { code: `PAYSTACK_FEE_EXPENSE_${currencyCode}` }, create: { code: `PAYSTACK_FEE_EXPENSE_${currencyCode}`, name: "Paystack processing fee", type: "EXPENSE", currency: currencyCode }, update: {} }),
        ]);
        const common = {
          journalReference: `PAYMENT-${attempt.id}`,
          currency: currencyCode,
          ...(isRide ? { rideBookingId: booking.id } : { parcelBookingId: booking.id }),
          paymentAttemptId: attempt.id,
          metadata: { provider: "PAYSTACK", providerReference: reference },
        };
        const entries = [
          { accountId: accounts[0].id, side: "DEBIT", amountMinor: amountMinor - fee, description: "Payment received net of provider fee" },
          ...(fee > 0n ? [{ accountId: accounts[3].id, side: "DEBIT", amountMinor: fee, description: "Paystack processing fee" }] : []),
          { accountId: accounts[1].id, side: "CREDIT", amountMinor: driverAmount, description: "Driver fare payable" },
          { accountId: accounts[2].id, side: "CREDIT", amountMinor: platformAmount, description: "Fixed platform connection fee revenue" },
        ].filter((entry) => entry.amountMinor > 0n);
        await tx.ledgerEntry.createMany({ data: entries.map((entry) => ({ ...common, ...entry })) });
        await tx.bookingEvent.create({
          data: {
            ...(isRide ? { rideBookingId: booking.id } : { parcelBookingId: booking.id }),
            eventType: "PAYMENT_CONFIRMED",
            fromStatus: "PAYMENT_PENDING",
            toStatus: "DRIVER_ASSIGNED",
            metadata: { paymentAttemptId: attempt.id, reference },
          },
        });
        return { duplicate: false, paymentAttemptId: attempt.id, assignmentId: assignment.id, bookingId: booking.id, bookingType: isRide ? "PASSENGER_RIDE" : "PARCEL_DELIVERY", customerId: isRide ? booking.passengerId : booking.senderId, driverUserId: assignment.driverProfile.userId, publicReference: booking.publicReference, amountMinor: amountMinor.toString(), currency: attempt.currency };
      });
    },
    async processFailedWebhook({ reference, payload, now }) {
      return prismaClient.$transaction(async (tx) => {
        const attempt = await tx.paymentAttempt.findUnique({ where: { providerReference: reference } });
        if (!attempt) throw new NotFoundError("Payment reference was not found.");
        if (attempt.status === "SUCCEEDED") return { duplicate: true };
        if (attempt.status === "FAILED") return { duplicate: true };
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", failedAt: now, providerPayload: payload } });
        if (attempt.rideBookingId) {
          await tx.rideBooking.updateMany({ where: { id: attempt.rideBookingId, status: "PAYMENT_PENDING" }, data: { status: "AWAITING_PAYMENT", paymentStatus: "FAILED" } });
          await tx.bookingEvent.create({ data: { rideBookingId: attempt.rideBookingId, eventType: "PAYMENT_FAILED", fromStatus: "PAYMENT_PENDING", toStatus: "AWAITING_PAYMENT", metadata: { paymentAttemptId: attempt.id } } });
        } else if (attempt.parcelBookingId) {
          await tx.parcelBooking.updateMany({ where: { id: attempt.parcelBookingId, status: "PAYMENT_PENDING" }, data: { status: "AWAITING_PAYMENT", paymentStatus: "FAILED" } });
          await tx.bookingEvent.create({ data: { parcelBookingId: attempt.parcelBookingId, eventType: "PAYMENT_FAILED", fromStatus: "PAYMENT_PENDING", toStatus: "AWAITING_PAYMENT", metadata: { paymentAttemptId: attempt.id } } });
        }
        return { duplicate: false };
      });
    },

    async createRefundRequest({ bookingType, bookingId, userId, idempotencyKey, reason, now }) {
      const existing = await prismaClient.refund.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.requestedByUserId !== userId) throw conflict("The idempotency key belongs to another account.", "IDEMPOTENCY_CONFLICT");
        return { refund: existing, replay: true };
      }
      return prismaClient.$transaction(async (tx) => {
        const isRide = bookingType === "PASSENGER_RIDE";
        const booking = isRide ? await tx.rideBooking.findUnique({ where: { id: bookingId } }) : await tx.parcelBooking.findUnique({ where: { id: bookingId } });
        if (!booking) throw new NotFoundError("The booking was not found.");
        if ((isRide ? booking.passengerId : booking.senderId) !== userId) throw conflict("You cannot request a refund for this booking.", "BOOKING_ACCESS_DENIED");
        if (booking.status !== "CANCELLATION_PENDING" || booking.paymentStatus !== "SUCCEEDED") throw conflict("A refund can only be requested for a paid booking awaiting cancellation review.", "REFUND_NOT_ELIGIBLE");
        const attempt = await tx.paymentAttempt.findFirst({ where: { status: "SUCCEEDED", ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }) }, orderBy: { verifiedAt: "desc" } });
        if (!attempt) throw conflict("A verified payment attempt was not found.", "PAYMENT_NOT_FOUND");
        const existingActive = await tx.refund.findFirst({ where: { paymentAttemptId: attempt.id, status: { in: ["REQUESTED", "PROCESSING", "SUCCEEDED"] } } });
        if (existingActive) throw conflict("A refund has already been requested for this payment.", "REFUND_ALREADY_REQUESTED");
        const refund = await tx.refund.create({
          data: {
            paymentAttemptId: attempt.id, requestedByUserId: userId,
            ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
            amountMinor: booking.customerPayableMinor, currency: booking.currency, reason, idempotencyKey,
          },
        });
        await tx.bookingEvent.create({ data: { ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }), actorUserId: userId, eventType: "REFUND_REQUESTED", fromStatus: "CANCELLATION_PENDING", toStatus: "CANCELLATION_PENDING", metadata: { refundId: refund.id, amountMinor: refund.amountMinor.toString() } } });
        return { refund, replay: false };
      });
    },
    findRefundById(id) {
      return prismaClient.refund.findUnique({ where: { id }, include: { paymentAttempt: true } });
    },
    listPayouts({ status, cursor, limit }) {
      return prismaClient.driverPayout.findMany({ where: status ? { status } : {}, orderBy: { requestedAt: "asc" }, take: limit + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    },
    listRefunds({ status, cursor, limit }) {
      return prismaClient.refund.findMany({ where: status ? { status } : {}, orderBy: { requestedAt: "asc" }, take: limit + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    },
    async markRefundProcessing({ id, providerReference, providerPayload }) {
      return prismaClient.refund.update({ where: { id }, data: { status: "PROCESSING", providerReference, providerPayload } });
    },
    async settleRefund({ providerReference, payload, now, succeeded }) {
      return prismaClient.$transaction(async (tx) => {
        const refund = await tx.refund.findUnique({ where: { providerReference }, include: { paymentAttempt: true } });
        if (!refund) throw new NotFoundError("The refund reference was not found.");
        if (["SUCCEEDED", "FAILED", "REJECTED"].includes(refund.status)) return { duplicate: true, refundId: refund.id };
        if (!succeeded) {
          await tx.refund.update({ where: { id: refund.id }, data: { status: "FAILED", failureReason: "Provider reported refund failure.", providerPayload: payload, processedAt: now } });
          return { duplicate: false, refundId: refund.id, status: "FAILED" };
        }
        const payout = await tx.driverPayout.findFirst({ where: { status: { in: ["PENDING", "ELIGIBLE", "PROCESSING", "PAID"] }, ...(refund.rideBookingId ? { rideBookingId: refund.rideBookingId } : { parcelBookingId: refund.parcelBookingId }) } });
        if (payout) throw conflict("The driver has already been paid. This refund requires manual financial review.", "PAYOUT_ALREADY_SETTLED");
        const attempt = refund.paymentAttempt;
        const isRide = Boolean(refund.rideBookingId);
        const booking = isRide ? await tx.rideBooking.findUnique({ where: { id: refund.rideBookingId } }) : await tx.parcelBooking.findUnique({ where: { id: refund.parcelBookingId } });
        if (!booking || booking.status !== "CANCELLATION_PENDING" || booking.paymentStatus !== "SUCCEEDED") throw conflict("The booking is not in a refundable cancellation state.", "REFUND_BOOKING_STATE_CONFLICT");
        const driverAmount = attempt.driverAllocationMinor ?? 0n;
        const platformAmount = attempt.platformAllocationMinor ?? 0n;
        if (driverAmount + platformAmount !== refund.amountMinor) throw conflict("Refund allocations do not balance.", "REFUND_ALLOCATION_MISMATCH");
        const currency = refund.currency;
        const clearing = await tx.ledgerAccount.findUnique({ where: { code: `PAYSTACK_CLEARING_${currency}` } });
        const driverPayable = await tx.ledgerAccount.findUnique({ where: { code: `DRIVER_PAYABLE_${currency}` } });
        const platformRevenue = await tx.ledgerAccount.findUnique({ where: { code: `PLATFORM_CONNECTION_FEE_${currency}` } });
        if (!clearing || !driverPayable || !platformRevenue) throw conflict("The original payment journal is incomplete.", "LEDGER_ACCOUNT_MISSING");
        const common = { journalReference: `REFUND-${refund.id}`, currency, ...(isRide ? { rideBookingId: refund.rideBookingId } : { parcelBookingId: refund.parcelBookingId }), paymentAttemptId: attempt.id, description: "Customer refund", metadata: { refundId: refund.id, providerReference } };
        const entries = [
          ...(driverAmount > 0n ? [{ accountId: driverPayable.id, side: "DEBIT", amountMinor: driverAmount }] : []),
          ...(platformAmount > 0n ? [{ accountId: platformRevenue.id, side: "DEBIT", amountMinor: platformAmount }] : []),
          { accountId: clearing.id, side: "CREDIT", amountMinor: refund.amountMinor },
        ];
        await tx.ledgerEntry.createMany({ data: entries.map((entry) => ({ ...common, ...entry })) });
        await tx.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", processedAt: now, providerPayload: payload } });
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "REVERSED" } });
        if (isRide) {
          await tx.rideBooking.update({ where: { id: booking.id }, data: { status: "CANCELLED", paymentStatus: "REVERSED", cancelledAt: now } });
          await tx.bookingEvent.create({ data: { rideBookingId: booking.id, eventType: "REFUND_COMPLETED", fromStatus: "CANCELLATION_PENDING", toStatus: "CANCELLED", metadata: { refundId: refund.id } } });
        } else {
          await tx.parcelBooking.update({ where: { id: booking.id }, data: { status: "CANCELLED", paymentStatus: "REVERSED", cancelledAt: now } });
          await tx.bookingEvent.create({ data: { parcelBookingId: booking.id, eventType: "REFUND_COMPLETED", fromStatus: "CANCELLATION_PENDING", toStatus: "CANCELLED", metadata: { refundId: refund.id } } });
        }
        return { duplicate: false, refundId: refund.id, status: "SUCCEEDED" };
      });
    },
    async createPayoutRequest({ bookingType, bookingId, userId, idempotencyKey, reference }) {
      return prismaClient.$transaction(async (tx) => {
        const isRide = bookingType === "PASSENGER_RIDE";
        const booking = isRide
          ? await tx.rideBooking.findUnique({ where: { id: bookingId }, include: { assignments: { where: { status: "COMPLETED" }, include: { driverProfile: { include: { settlementAccounts: { where: { status: "VERIFIED", provider: "PAYSTACK" } } } } } } })
          : await tx.parcelBooking.findUnique({ where: { id: bookingId }, include: { assignments: { where: { status: "COMPLETED" }, include: { driverProfile: { include: { settlementAccounts: { where: { status: "VERIFIED", provider: "PAYSTACK" } } } } } } });
        if (!booking) throw new NotFoundError("The booking was not found.");
        if (booking.status !== "COMPLETED" || booking.paymentStatus !== "SUCCEEDED") throw conflict("Payout is available only after a paid booking is completed.", "PAYOUT_NOT_ELIGIBLE");
        const assignment = booking.assignments[0];
        if (!assignment || assignment.driverProfile.userId !== userId) throw conflict("You are not the driver for this completed booking.", "PAYOUT_ACCESS_DENIED");
        const account = assignment.driverProfile.settlementAccounts[0];
        if (!account) throw conflict("A verified Paystack settlement recipient is required before payout.", "SETTLEMENT_ACCOUNT_NOT_READY");
        const existing = await tx.driverPayout.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.driverProfileId !== assignment.driverProfileId) throw conflict("The idempotency key belongs to another driver.", "IDEMPOTENCY_CONFLICT");
          return { payout: existing, recipientCode: account.externalAccountRef, replay: true };
        }
        const alreadyPaid = await tx.driverPayout.findFirst({ where: { status: { in: ["PENDING", "ELIGIBLE", "PROCESSING", "PAID"] }, ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }) } });
        if (alreadyPaid) throw conflict("A payout already exists for this booking.", "PAYOUT_ALREADY_EXISTS");
        const payout = await tx.driverPayout.create({
          data: {
            driverProfileId: assignment.driverProfileId,
            ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
            amountMinor: assignment.agreedFareMinor, currency: assignment.currency, status: "PENDING",
            provider: "PAYSTACK", providerReference: reference, idempotencyKey,
          },
        });
        return { payout, recipientCode: account.externalAccountRef, replay: false };
      });
    },
    async settlePayoutWebhook({ reference, amountMinor, payload, now, succeeded }) {
      return prismaClient.$transaction(async (tx) => {
        const payout = await tx.driverPayout.findUnique({ where: { providerReference: reference } });
        if (!payout) throw new NotFoundError("The payout reference was not found.");
        if (payout.status === "PAID" || payout.status === "FAILED") return { duplicate: true, payoutId: payout.id };
        if (!succeeded) {
          await tx.driverPayout.update({ where: { id: payout.id }, data: { status: "FAILED", failureReason: "Provider reported transfer failure.", processedAt: now } });
          return { duplicate: false, payoutId: payout.id, status: "FAILED" };
        }
        if (amountMinor !== payout.amountMinor) throw conflict("The transfer amount does not match the payout record.", "PAYOUT_AMOUNT_MISMATCH");
        const currency = payout.currency;
        const payable = await tx.ledgerAccount.findUnique({ where: { code: `DRIVER_PAYABLE_${currency}` } });
        const clearing = await tx.ledgerAccount.findUnique({ where: { code: `PAYSTACK_CLEARING_${currency}` } });
        if (!payable || !clearing) throw conflict("The payout ledger accounts are missing.", "LEDGER_ACCOUNT_MISSING");
        const update = await tx.driverPayout.updateMany({ where: { id: payout.id, status: { in: ["PENDING", "ELIGIBLE", "PROCESSING"] } }, data: { status: "PAID", processedAt: now } });
        if (update.count !== 1) return { duplicate: true, payoutId: payout.id };
        await tx.ledgerEntry.createMany({ data: [
          { journalReference: `PAYOUT-${payout.id}`, accountId: payable.id, side: "DEBIT", amountMinor: payout.amountMinor, currency, ...(payout.rideBookingId ? { rideBookingId: payout.rideBookingId } : { parcelBookingId: payout.parcelBookingId }), payoutId: payout.id, description: "Driver payout settled", metadata: { providerReference: reference } },
          { journalReference: `PAYOUT-${payout.id}`, accountId: clearing.id, side: "CREDIT", amountMinor: payout.amountMinor, currency, ...(payout.rideBookingId ? { rideBookingId: payout.rideBookingId } : { parcelBookingId: payout.parcelBookingId }), payoutId: payout.id, description: "Paystack transfer paid", metadata: { providerReference: reference } },
        ] });
        return { duplicate: false, payoutId: payout.id, status: "PAID" };
      });
    },
    findAttemptByReference(reference) {
      return prismaClient.paymentAttempt.findUnique({ where: { providerReference: reference } });
    },
  };
}
