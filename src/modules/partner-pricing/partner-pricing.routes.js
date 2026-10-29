import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";

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

const partnerInput = z.object({
  displayName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().email().max(254).optional(),
  contactPhone: z.string().trim().min(7).max(32).optional(),
}).strict();
const partnerStatusInput = z.object({
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]),
  verificationStatus: z.enum(["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]).optional(),
}).strict();
const agreementInput = z.object({
  reference: z.string().trim().min(2).max(100),
  currency: z.string().trim().length(3).default("NGN"),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
  volumeCommitment: z.record(z.string(), z.unknown()).optional(),
  serviceStandards: z.record(z.string(), z.unknown()).optional(),
  custodyClaimsTerms: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((v) => !v.effectiveUntil || !v.effectiveFrom || v.effectiveUntil > v.effectiveFrom, {
  message: "effectiveUntil must be later than effectiveFrom.",
  path: ["effectiveUntil"],
});
const agreementStatusInput = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"]),
}).strict();
const rateCardInput = z.object({
  currency: z.string().trim().length(3).default("NGN"),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
}).strict().refine((v) => !v.effectiveUntil || !v.effectiveFrom || v.effectiveUntil > v.effectiveFrom, {
  message: "effectiveUntil must be later than effectiveFrom.",
  path: ["effectiveUntil"],
});
const partnerRateInput = z.object({
  originServiceZoneId: id,
  destinationServiceZoneId: id,
  serviceType: z.enum(["PARCEL_DELIVERY", "PASSENGER_RIDE", "HUB_POINT", "BUSINESS_LOGISTICS"]).default("PARCEL_DELIVERY"),
  parcelCategory: z.string().trim().min(2).max(80),
  minWeightGrams: z.number().int().min(0).max(100000000).default(0),
  maxWeightGrams: z.number().int().min(1).max(100000000).optional(),
  maxLengthMm: z.number().int().min(1).max(1000000).optional(),
  maxWidthMm: z.number().int().min(1).max(1000000).optional(),
  maxHeightMm: z.number().int().min(1).max(1000000).optional(),
  transportChargeMinor: z.string().regex(/^[1-9][0-9]{0,14}$/),
  estimatedTransitMinutes: z.number().int().min(1).max(1000000).optional(),
}).strict().refine((v) => v.maxWeightGrams === undefined || v.maxWeightGrams >= v.minWeightGrams, {
  message: "maxWeightGrams must be greater than or equal to minWeightGrams.",
  path: ["maxWeightGrams"],
});

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

export function createPartnerPricingRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const admin = requireRole("ADMIN");

  // Admins can issue a versioned quote. Manual transport charges require an explicit reason;
  // no fallback price is inferred when no contracted rate exists.
  router.post("/admin/parcel-bookings/:bookingId/quotes", requireAuth, admin, async (req, res, next) => {
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
        if (["COMPLETED", "CANCELLED", "FAILED"].includes(booking.status)) {
          return { conflict: "A quote cannot be issued for a terminal booking." };
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

  router.get("/parcel-bookings/:bookingId/quotes", requireAuth, async (req, res, next) => {
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

  router.post("/parcel-bookings/:bookingId/quotes/:quoteId/accept", requireAuth, async (req, res, next) => {
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
        await tx.parcelBooking.update({
          where: { id: booking.id },
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
        return { quote: await tx.shipmentQuote.findUnique({ where: { id: quote.id } }) };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (result.quoteNotFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Quote not found for this booking." } });
      if (result.forbidden) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot accept this quote." } });
      if (result.conflict) return res.status(409).json({ success: false, error: { code: "QUOTE_NOT_ACCEPTABLE", message: "This quote is no longer available or has expired." } });
      return res.status(200).json({ success: true, data: { quote: quoteView(result.quote) } });
    } catch (error) { return next(error); }
  });

  router.post("/parcel-bookings/:bookingId/quotes/:quoteId/reject", requireAuth, async (req, res, next) => {
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
        return true;
      });
      if (!result) return res.status(409).json({ success: false, error: { code: "QUOTE_NOT_REJECTABLE", message: "Quote is no longer available." } });
      return res.status(200).json({ success: true, data: { rejected: true } });
    } catch (error) { return next(error); }
  });

  router.get("/admin/transport-partners", requireAuth, admin, async (req, res, next) => {
    try {
      const partners = await prismaClient.transportPartner.findMany({
        orderBy: [{ createdAt: "desc" }],
        include: { _count: { select: { agreements: true } } },
      });
      return res.status(200).json({ success: true, data: { items: partners } });
    } catch (error) { return next(error); }
  });

  router.post("/admin/transport-partners", requireAuth, admin, async (req, res, next) => {
    const parsed = partnerInput.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    try {
      const partner = await prismaClient.transportPartner.create({ data: parsed.data });
      return res.status(201).json({ success: true, data: { partner } });
    } catch (error) { return next(error); }
  });

  router.patch("/admin/transport-partners/:partnerId/status", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.partnerId);
    const parsed = partnerStatusInput.safeParse(req.body);
    if (!parsedId.success || !parsed.success) {
      return invalid(res, [...(parsedId.success ? [] : parsedId.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
    }
    try {
      const currentPartner = await prismaClient.transportPartner.findUnique({ where: { id: parsedId.data } });
      if (!currentPartner) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Transport partner not found." } });
      const nextVerification = parsed.data.verificationStatus ?? currentPartner.verificationStatus;
      if (parsed.data.status === "ACTIVE" && nextVerification !== "VERIFIED") {
        return res.status(409).json({ success: false, error: { code: "PARTNER_NOT_VERIFIED", message: "A partner must be verified before activation." } });
      }
      const partner = await prismaClient.transportPartner.update({
        where: { id: parsedId.data },
        data: {
          status: parsed.data.status,
          ...(parsed.data.verificationStatus ? { verificationStatus: parsed.data.verificationStatus } : {}),
          ...(nextVerification === "VERIFIED" ? { verifiedAt: currentPartner.verifiedAt ?? new Date() } : {}),
        },
      });
      return res.status(200).json({ success: true, data: { partner } });
    } catch (error) { return next(error); }
  });

  router.post("/admin/transport-partners/:partnerId/agreements", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.partnerId);
    const parsed = agreementInput.safeParse(req.body);
    if (!parsedId.success || !parsed.success) {
      return invalid(res, [...(parsedId.success ? [] : parsedId.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
    }
    try {
      const partner = await prismaClient.transportPartner.findUnique({ where: { id: parsedId.data } });
      if (!partner) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Transport partner not found." } });
      const agreement = await prismaClient.partnerAgreement.create({
        data: {
          partnerId: partner.id,
          reference: parsed.data.reference,
          currency: parsed.data.currency.toUpperCase(),
          effectiveFrom: parsed.data.effectiveFrom ?? new Date(),
          effectiveUntil: parsed.data.effectiveUntil,
          volumeCommitment: parsed.data.volumeCommitment,
          serviceStandards: parsed.data.serviceStandards,
          custodyClaimsTerms: parsed.data.custodyClaimsTerms,
          status: "DRAFT",
        },
      });
      return res.status(201).json({ success: true, data: { agreement } });
    } catch (error) { return next(error); }
  });

  router.post("/admin/partner-agreements/:agreementId/activate", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.agreementId);
    if (!parsedId.success) return invalid(res, parsedId.error.issues);
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const agreement = await tx.partnerAgreement.findUnique({
          where: { id: parsedId.data }, include: { partner: true },
        });
        if (!agreement) return { notFound: true };
        const now = new Date();
        if (agreement.status !== "DRAFT") return { blocker: "NOT_DRAFT" };
        if (
          agreement.partner.status !== "ACTIVE" ||
          agreement.partner.verificationStatus !== "VERIFIED"
        ) return { blocker: "PARTNER_NOT_ELIGIBLE" };
        if (agreement.effectiveFrom > now || (agreement.effectiveUntil && agreement.effectiveUntil <= now)) {
          return { blocker: "OUTSIDE_EFFECTIVE_DATES" };
        }
        const activeAgreement = await tx.partnerAgreement.findFirst({
          where: { partnerId: agreement.partnerId, status: "ACTIVE", id: { not: agreement.id } },
          select: { id: true },
        });
        if (activeAgreement) return { blocker: "ACTIVE_AGREEMENT_EXISTS" };
        const updated = await tx.partnerAgreement.update({
          where: { id: agreement.id }, data: { status: "ACTIVE", approvedAt: now },
        });
        return { agreement: updated };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner agreement not found." } });
      const activationErrors = {
        NOT_DRAFT: ["AGREEMENT_NOT_DRAFT", "Only draft agreements can be activated."],
        PARTNER_NOT_ELIGIBLE: ["PARTNER_NOT_ELIGIBLE", "The partner must be active and verified."],
        OUTSIDE_EFFECTIVE_DATES: ["AGREEMENT_OUTSIDE_EFFECTIVE_DATES", "The agreement is not currently within its effective dates."],
        ACTIVE_AGREEMENT_EXISTS: ["ACTIVE_AGREEMENT_EXISTS", "This partner already has an active agreement. Suspend or terminate it before activating another."],
      };
      if (result.blocker) {
        const [code, message] = activationErrors[result.blocker];
        return res.status(409).json({ success: false, error: { code, message } });
      }
      return res.status(200).json({ success: true, data: { agreement: result.agreement } });
    } catch (error) { return next(error); }
  });

  router.patch("/admin/partner-agreements/:agreementId/status", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.agreementId);
    const parsed = agreementStatusInput.safeParse(req.body);
    if (!parsedId.success || !parsed.success) {
      return invalid(res, [...(parsedId.success ? [] : parsedId.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
    }
    try {
      const agreement = await prismaClient.partnerAgreement.findUnique({
        where: { id: parsedId.data }, include: { partner: true },
      });
      if (!agreement) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner agreement not found." } });
      if (agreement.status === "TERMINATED" || agreement.status === "EXPIRED") {
        return res.status(409).json({ success: false, error: { code: "AGREEMENT_TERMINAL", message: "Expired or terminated agreements cannot be changed." } });
      }
      if (parsed.data.status === "ACTIVE") {
        return res.status(409).json({ success: false, error: { code: "USE_ACTIVATION_ENDPOINT", message: "Use the agreement activation endpoint to enforce partner and effective-date checks." } });
      }
      const updated = await prismaClient.partnerAgreement.update({
        where: { id: agreement.id }, data: { status: parsed.data.status },
      });
      return res.status(200).json({ success: true, data: { agreement: updated } });
    } catch (error) { return next(error); }
  });

  router.post("/admin/partner-agreements/:agreementId/rate-cards", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.agreementId);
    const parsed = rateCardInput.safeParse(req.body);
    if (!parsedId.success || !parsed.success) {
      return invalid(res, [...(parsedId.success ? [] : parsedId.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
    }
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const agreement = await tx.partnerAgreement.findUnique({ where: { id: parsedId.data } });
        if (!agreement) return { notFound: true };
        if (agreement.status !== "DRAFT" && agreement.status !== "ACTIVE") return { conflict: true };
        const latest = await tx.partnerRateCard.findFirst({
          where: { agreementId: agreement.id }, orderBy: { version: "desc" }, select: { version: true },
        });
        const card = await tx.partnerRateCard.create({ data: {
          agreementId: agreement.id,
          version: (latest?.version ?? 0) + 1,
          currency: parsed.data.currency.toUpperCase(),
          effectiveFrom: parsed.data.effectiveFrom ?? new Date(),
          effectiveUntil: parsed.data.effectiveUntil,
          status: "DRAFT",
        } });
        return { card };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner agreement not found." } });
      if (result.conflict) return res.status(409).json({ success: false, error: { code: "AGREEMENT_NOT_EDITABLE", message: "Rate cards can only be drafted under draft or active agreements." } });
      return res.status(201).json({ success: true, data: { rateCard: result.card } });
    } catch (error) { return next(error); }
  });

  router.post("/admin/partner-rate-cards/:rateCardId/rates", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.rateCardId);
    const parsed = partnerRateInput.safeParse(req.body);
    if (!parsedId.success || !parsed.success) {
      return invalid(res, [...(parsedId.success ? [] : parsedId.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
    }
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const card = await tx.partnerRateCard.findUnique({ where: { id: parsedId.data } });
        if (!card) return { notFound: true };
        if (card.status !== "DRAFT") return { conflict: true };
        const zones = await tx.serviceZone.findMany({
          where: { id: { in: [parsed.data.originServiceZoneId, parsed.data.destinationServiceZoneId] }, isActive: true },
          select: { id: true },
        });
        if (new Set(zones.map((zone) => zone.id)).size !== 2) return { invalidZones: true };
        const rate = await tx.partnerRate.create({
          data: {
            rateCardId: card.id,
            ...parsed.data,
            transportChargeMinor: BigInt(parsed.data.transportChargeMinor),
          },
        });
        return { rate };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner rate card not found." } });
      if (result.conflict) return res.status(409).json({ success: false, error: { code: "RATE_CARD_NOT_DRAFT", message: "Rates can only be added to draft rate cards." } });
      if (result.invalidZones) return res.status(409).json({ success: false, error: { code: "SERVICE_ZONE_INACTIVE", message: "Both route zones must exist and be active." } });
      return res.status(201).json({ success: true, data: { rate: { ...result.rate, transportChargeMinor: result.rate.transportChargeMinor.toString() } } });
    } catch (error) { return next(error); }
  });

  // Publishing is the only path that makes a draft rate card selectable for quotes.
  // Publishing requires a verified, active partner and an active agreement; one active
  // version per agreement is retained to prevent overlapping rate-card selection.
  router.post("/admin/partner-rate-cards/:rateCardId/publish", requireAuth, admin, async (req, res, next) => {
    const parsedId = id.safeParse(req.params.rateCardId);
    if (!parsedId.success) return invalid(res, parsedId.error.issues);
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const now = new Date();
        const card = await tx.partnerRateCard.findUnique({
          where: { id: parsedId.data },
          include: { agreement: { include: { partner: true } }, rates: { where: { isActive: true } } },
        });
        if (!card) return { notFound: true };
        const blocker = getRateCardPublishBlocker(card, now);
        if (blocker) return { blocker };

        await tx.partnerRateCard.updateMany({
          where: { agreementId: card.agreementId, status: "ACTIVE", id: { not: card.id } },
          data: { status: "RETIRED" },
        });
        const published = await tx.partnerRateCard.update({
          where: { id: card.id },
          data: { status: "ACTIVE", publishedAt: now },
          select: {
            id: true, agreementId: true, version: true, status: true, currency: true,
            effectiveFrom: true, effectiveUntil: true, publishedAt: true, updatedAt: true,
          },
        });
        return { card: published };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner rate card not found." } });
      const publishErrors = {
        NOT_DRAFT: ["RATE_CARD_NOT_DRAFT", "Only draft rate cards can be published."],
        PARTNER_AGREEMENT_INELIGIBLE: ["PARTNER_AGREEMENT_INELIGIBLE", "The partner must be active and verified, and the agreement must be active and in date."],
        OUTSIDE_EFFECTIVE_DATES: ["RATE_CARD_OUTSIDE_EFFECTIVE_DATES", "The rate card is not currently within its effective dates."],
        NO_ACTIVE_RATES: ["RATE_CARD_HAS_NO_ACTIVE_RATES", "Add at least one active rate before publishing this rate card."],
      };
      if (result.blocker) {
        const [code, message] = publishErrors[result.blocker];
        return res.status(409).json({ success: false, error: { code, message } });
      }
      return res.status(200).json({ success: true, data: { rateCard: result.card } });
    } catch (error) { return next(error); }
  });

  return router;
}

export const partnerPricingRouter = createPartnerPricingRouter();
