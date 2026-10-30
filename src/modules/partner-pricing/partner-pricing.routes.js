import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPartnerPricingAdminRouter } from "./partner-pricing.admin.routes.js";

const id = z.string().trim().min(1).max(128);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const quoteInput = z.object({
  partnerRateId: id.optional(),
  transportChargeMinor: minor.optional(),
  collectionChargeMinor: minor.default("0"),
  hubHandlingChargeMinor: minor.default("0"),
  destinationDeliveryChargeMinor: minor.default("0"),
  platformChargeMinor: minor.default("0"),
  otherChargesMinor: minor.default("0"),
  expiresInMinutes: z.number().int().min(5).max(10080).default(1440),
  reason: z.string().trim().max(500).optional(),
}).strict().refine((v) => Boolean(v.partnerRateId) || v.transportChargeMinor !== undefined, {
  message: "Provide a partner rate or an explicitly approved transport charge.",
});
const rejectionInput = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export function isPositiveMinorAmount(value) {
  return /^(?:[1-9][0-9]{0,14})$/.test(String(value));
}

export function buildPartnerRateEligibilityWhere(booking, now = new Date()) {
  return {
    isActive: true,
    originServiceZoneId: booking.pickupServiceZoneId,
    destinationServiceZoneId: booking.destinationServiceZoneId,
    serviceType: "PARCEL_DELIVERY",
    parcelCategory: booking.parcelCategory,
    rateCard: {
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      agreement: {
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      },
    },
  };
}

export function getRateCardPublishBlocker(card, now = new Date()) {
  if (card.status !== "DRAFT") return "NOT_DRAFT";
  const agreement = card.agreement;
  if (
    agreement.status !== "ACTIVE" ||
    agreement.effectiveFrom > now ||
    (agreement.effectiveUntil && agreement.effectiveUntil <= now) ||
    agreement.partner.status !== "ACTIVE" ||
    agreement.partner.verificationStatus !== "VERIFIED"
  ) return "PARTNER_AGREEMENT_INELIGIBLE";
  if (card.effectiveFrom > now || (card.effectiveUntil && card.effectiveUntil <= now)) {
    return "OUTSIDE_EFFECTIVE_DATES";
  }
  if (card.rates.length === 0) return "NO_ACTIVE_RATES";
  return null;
}

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
    details: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  } });
}
function quoteView(q) {
  return {
    id: q.id, parcelBookingId: q.parcelBookingId, version: q.version, status: q.status,
    partnerAgreementId: q.partnerAgreementId, partnerRateId: q.partnerRateId, currency: q.currency,
    transportChargeMinor: q.transportChargeMinor.toString(),
    collectionChargeMinor: q.collectionChargeMinor.toString(),
    hubHandlingChargeMinor: q.hubHandlingChargeMinor.toString(),
    destinationDeliveryChargeMinor: q.destinationDeliveryChargeMinor.toString(),
    platformChargeMinor: q.platformChargeMinor.toString(),
    otherChargesMinor: q.otherChargesMinor.toString(),
    totalCustomerChargeMinor: q.totalCustomerChargeMinor.toString(),
    chargeBreakdown: q.chargeBreakdown, expiresAt: q.expiresAt,
    offeredAt: q.offeredAt, acceptedAt: q.acceptedAt,
  };
}

export function createPartnerPricingRouter({
  prismaClient = prisma,
  authMiddleware = requireAuth,
  adminMiddleware = requireRole("ADMIN"),
} = {}) {
  const router = Router();
  const admin = adminMiddleware;
  router.use("/admin", createPartnerPricingAdminRouter({ prismaClient, authMiddleware, adminMiddleware }));

  // Admins can issue a versioned quote. Manual transport charges require an explicit reason;
  // no fallback price is inferred when no contracted rate exists.
  router.post("/admin/parcel-bookings/:bookingId/quotes", authMiddleware, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.bookingId);
    if (!parsedId.success) return invalid(res, parsedId.error.issues);
    const parsed = quoteInput.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const input = parsed.data;
    if (!input.partnerRateId && !input.reason) {
      return res.status(400).json({ success: false, error: {
        code: "MANUAL_QUOTE_REASON_REQUIRED", message: "A reason is required for a manually approved transport charge.",
      } });
    }
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const booking = await tx.parcelBooking.findUnique({ where: { id: parsedId.data } });
        if (!booking) return { notFound: true };
        if (booking.status !== "DRAFT") {
          return { conflict: "A partner quote can only be issued while the booking is still a draft." };
        }
        let rate = null;
        if (input.partnerRateId) {
          rate = await tx.partnerRate.findFirst({
            where: {
              id: input.partnerRateId,
              ...buildPartnerRateEligibilityWhere(booking),
            },
            include: { rateCard: { include: { agreement: true } } },
          });
          if (!rate) return { invalidRate: true };
        }
        const transport = BigInt(rate ? rate.transportChargeMinor.toString() : input.transportChargeMinor);
        const collection = BigInt(input.collectionChargeMinor);
        const handling = BigInt(input.hubHandlingChargeMinor);
        const destination = BigInt(input.destinationDeliveryChargeMinor);
        const platform = BigInt(input.platformChargeMinor);
        const other = BigInt(input.otherChargesMinor);
        if (!isPositiveMinorAmount(transport)) return { invalidTransport: true };
        const total = transport + collection + handling + destination + platform + other;
        const previous = await tx.shipmentQuote.findFirst({
          where: { parcelBookingId: booking.id }, orderBy: { version: "desc" }, select: { version: true },
        });
        await tx.shipmentQuote.updateMany({
          where: { parcelBookingId: booking.id, status: "OFFERED" },
          data: { status: "SUPERSEDED" },
        });
        const quote = await tx.shipmentQuote.create({ data: {
          parcelBookingId: booking.id, version: (previous?.version ?? 0) + 1,
          status: "OFFERED", partnerAgreementId: rate?.rateCard.agreementId ?? null,
          partnerRateId: rate?.id ?? null, currency: rate?.rateCard.currency ?? booking.currency,
          transportChargeMinor: transport, collectionChargeMinor: collection,
          hubHandlingChargeMinor: handling, destinationDeliveryChargeMinor: destination,
          platformChargeMinor: platform, otherChargesMinor: other,
          totalCustomerChargeMinor: total,
          chargeBreakdown: {
            transportChargeMinor: transport.toString(), collectionChargeMinor: collection.toString(),
            hubHandlingChargeMinor: handling.toString(), destinationDeliveryChargeMinor: destination.toString(),
            platformChargeMinor: platform.toString(), otherChargesMinor: other.toString(),
            manualQuoteReason: rate ? null : input.reason,
          },
          inputSnapshot: {
            pickupServiceZoneId: booking.pickupServiceZoneId,
            destinationServiceZoneId: booking.destinationServiceZoneId,
            parcelCategory: booking.parcelCategory, parcelSize: booking.parcelSize,
            partnerRateId: rate?.id ?? null, partnerRateCardVersion: rate?.rateCard.version ?? null,
            partnerAgreementId: rate?.rateCard.agreementId ?? null,
            manualQuoteReason: rate ? null : input.reason,
          },
          expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000),
        } });
        return { quote };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (result.conflict) return res.status(409).json({ success: false, error: { code: "BOOKING_NOT_QUOTABLE", message: result.conflict } });
      if (result.invalidRate) return res.status(409).json({ success: false, error: { code: "PARTNER_RATE_UNAVAILABLE", message: "The selected rate is not active for this route and service." } });
      if (result.invalidTransport) return res.status(400).json({ success: false, error: { code: "INVALID_TRANSPORT_CHARGE", message: "Transport charge must be greater than zero." } });
      return res.status(201).json({ success: true, data: { quote: quoteView(result.quote) } });
    } catch (error) { return next(error); }
  });

  router.get("/parcel-bookings/:bookingId/quotes", authMiddleware, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.bookingId);
    if (!parsedId.success) return invalid(res, parsedId.error.issues);
    try {
      const booking = await prismaClient.parcelBooking.findUnique({ where: { id: parsedId.data }, select: { id: true, senderId: true } });
      if (!booking) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (booking.senderId !== req.user.id && !["ADMIN", "SUPPORT"].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot view quotes for this booking." } });
      }
      const quotes = await prismaClient.shipmentQuote.findMany({
        where: { parcelBookingId: booking.id }, orderBy: { version: "desc" },
      });
      return res.status(200).json({ success: true, data: { items: quotes.map(quoteView) } });
    } catch (error) { return next(error); }
  });

  router.post("/parcel-bookings/:bookingId/quotes/:quoteId/accept", authMiddleware, async (req, res, next) => {
    const bookingId = id.safeParse(req.params.bookingId);
    const quoteId = id.safeParse(req.params.quoteId);
    if (!bookingId.success || !quoteId.success) return invalid(res, [...(bookingId.success ? [] : bookingId.error.issues), ...(quoteId.success ? [] : quoteId.error.issues)]);
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const booking = await tx.parcelBooking.findUnique({ where: { id: bookingId.data } });
        if (!booking) return { notFound: true };
        if (booking.senderId !== req.user.id) return { forbidden: true };
        const quote = await tx.shipmentQuote.findFirst({ where: { id: quoteId.data, parcelBookingId: booking.id } });
        if (!quote) return { quoteNotFound: true };
        if (quote.status === "ACCEPTED" && quote.acceptedByUserId === req.user.id) {
          return { quote, replay: true };
        }
        if (booking.status !== "DRAFT") {
          return { conflict: true };
        }
        const now = new Date();
        if (quote.status !== "OFFERED" || quote.expiresAt <= now) {
          if (quote.status === "OFFERED" && quote.expiresAt <= now) {
            await tx.shipmentQuote.updateMany({ where: { id: quote.id, status: "OFFERED" }, data: { status: "EXPIRED" } });
          }
          return { conflict: true };
        }
        const updated = await tx.shipmentQuote.updateMany({
          where: { id: quote.id, status: "OFFERED", expiresAt: { gt: now } },
          data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: req.user.id },
        });
        if (updated.count !== 1) return { conflict: true };
        await tx.shipmentQuote.updateMany({
          where: { parcelBookingId: booking.id, id: { not: quote.id }, status: "OFFERED" },
          data: { status: "SUPERSEDED" },
        });
        const bookingUpdate = await tx.parcelBooking.updateMany({
          where: {
            id: booking.id,
            senderId: req.user.id,
            status: { in: ["DRAFT", "MATCHING", "AWAITING_CUSTOMER_ACCEPTANCE"] },
          },
          data: {
            driverFareMinor: quote.transportChargeMinor,
            customerPayableMinor: quote.totalCustomerChargeMinor,
            connectionFeeMinor: quote.platformChargeMinor,
            otherChargesMinor: quote.otherChargesMinor + quote.collectionChargeMinor + quote.hubHandlingChargeMinor + quote.destinationDeliveryChargeMinor,
            pricingSnapshot: {
              quoteId: quote.id,
              quoteVersion: quote.version,
              currency: quote.currency,
              totalCustomerChargeMinor: quote.totalCustomerChargeMinor.toString(),
              chargeBreakdown: quote.chargeBreakdown,
              acceptedAt: now.toISOString(),
            },
            status: "AWAITING_PAYMENT",
          },
        });
        if (bookingUpdate.count !== 1) {
          const error = new Error("The booking has already moved beyond quote acceptance.");
          error.statusCode = 409;
          error.code = "BOOKING_NOT_QUOTABLE";
          throw error;
        }
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            actorUserId: req.user.id,
            eventType: "SHIPMENT_QUOTE_ACCEPTED",
            fromStatus: booking.status,
            toStatus: "AWAITING_PAYMENT",
            metadata: {
              quoteId: quote.id,
              quoteVersion: quote.version,
              totalCustomerChargeMinor: quote.totalCustomerChargeMinor.toString(),
              currency: quote.currency,
            },
          },
        });
        return { quote: await tx.shipmentQuote.findUnique({ where: { id: quote.id } }) };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (result.quoteNotFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Quote not found for this booking." } });
      if (result.forbidden) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot accept this quote." } });
      if (result.conflict) return res.status(409).json({ success: false, error: { code: "QUOTE_NOT_ACCEPTABLE", message: "This quote is no longer available or has expired." } });
      return res.status(200).json({ success: true, data: { quote: quoteView(result.quote), replay: result.replay === true } });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({ success: false, error: {
          code: error.code ?? "QUOTE_NOT_ACCEPTABLE",
          message: error.message ?? "This quote is no longer available or has expired.",
        } });
      }
      return next(error);
    }
  });

  router.post("/parcel-bookings/:bookingId/quotes/:quoteId/reject", authMiddleware, async (req, res, next) => {
    const bookingId = id.safeParse(req.params.bookingId);
    const quoteId = id.safeParse(req.params.quoteId);
    if (!bookingId.success || !quoteId.success) return invalid(res, [...(bookingId.success ? [] : bookingId.error.issues), ...(quoteId.success ? [] : quoteId.error.issues)]);
    const parsed = rejectionInput.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    try {
      const booking = await prismaClient.parcelBooking.findUnique({ where: { id: bookingId.data }, select: { id: true, senderId: true } });
      if (!booking) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (booking.senderId !== req.user.id) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot reject this quote." } });
      }
      const result = await prismaClient.$transaction(async (tx) => {
        const existing = await tx.shipmentQuote.findFirst({ where: { id: quoteId.data, parcelBookingId: booking.id } });
        if (existing?.status === "REJECTED") return { replay: true };
        if (!existing || existing.status !== "OFFERED") return false;
        const now = new Date();
        const updated = await tx.shipmentQuote.updateMany({
          where: { id: quoteId.data, parcelBookingId: booking.id, status: "OFFERED", expiresAt: { gt: now } },
          data: { status: "REJECTED" },
        });
        if (updated.count !== 1) return false;
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            actorUserId: req.user.id,
            eventType: "SHIPMENT_QUOTE_REJECTED",
            metadata: { quoteId: quoteId.data, reason: parsed.data.reason },
          },
        });
        return { replay: false };
      });
      if (!result) return res.status(409).json({ success: false, error: { code: "QUOTE_NOT_REJECTABLE", message: "Quote is no longer available." } });
      return res.status(200).json({ success: true, data: { rejected: true, replay: result.replay === true } });
    } catch (error) { return next(error); }
  });

  return router;
}

export const partnerPricingRouter = createPartnerPricingRouter();
