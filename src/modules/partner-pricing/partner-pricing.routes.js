import { Router } from "express";
import { createMultiLegPlan, getExistingDeliveryRoutePlan } from "../delivery-legs/delivery-plan.service.js";
import { assessPlatformRouteTariffs, rateFitsPackage } from "../platform-route-pricing/platform-route-tariff-assessment.service.js";
import { createCustomerShipmentQuotesService, customerQuoteView } from "../parcels/customer-shipment-quotes.service.js";
import { validateOperationalTripQuote } from "./operational-trip-pricing.service.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createPartnerPricingAdminRouter } from "./partner-pricing.admin.routes.js";

const id = z.string().trim().min(1).max(128);
const minor = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const quoteInput = z.object({
  partnerRateId: id.optional(),
  partnerAgreementId: id.optional(),
  transportChargeMinor: minor.optional(),
  collectionChargeMinor: minor.default("0"),
  hubHandlingChargeMinor: minor.default("0"),
  destinationDeliveryChargeMinor: minor.default("0"),
  platformChargeMinor: minor.default("0"),
  otherChargesMinor: minor.default("0"),
  expiresInMinutes: z.number().int().min(5).max(10080).default(1440),
  reason: z.string().trim().max(500).optional(),
}).strict().refine((v) => Boolean(v.partnerRateId) || (v.transportChargeMinor !== undefined && Boolean(v.partnerAgreementId)), {
  message: "Provide a contracted partner rate or a manual transport charge tied to an active partner agreement.",
});
const rejectionInput = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const customerQuoteInput = z.object({
  expiresInMinutes: z.number().int().min(5).max(1440).default(15),
}).strict();

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
      currency: booking.currency,
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
async function partnerRouteQuoteStillValid(tx, booking, quote, packages, now) {
  const snapshot = quote.inputSnapshot ?? {};
  const rateSnapshots = snapshot.partnerRateSnapshots ?? [];
  if (snapshot.source !== "PARTNER_RATE_CARD" || !rateSnapshots.length) return false;

  const pricingRule = await tx.pricingRule.findUnique({ where: { id: snapshot.pricingRuleId } });
  if (
    !pricingRule
    || !pricingRule.isActive
    || pricingRule.version !== snapshot.pricingRuleVersion
    || pricingRule.currency !== quote.currency
    || pricingRule.fixedConnectionFeeMinor.toString() !== quote.platformChargeMinor.toString()
    || pricingRule.effectiveFrom > now
    || (pricingRule.effectiveUntil && pricingRule.effectiveUntil <= now)
  ) return false;

  const rates = await tx.partnerRate.findMany({
    where: {
      id: { in: rateSnapshots.map(item => item.rateId) },
      isActive: true,
      originServiceZoneId: booking.pickupServiceZoneId,
      destinationServiceZoneId: booking.destinationServiceZoneId,
      serviceType: "PARCEL_DELIVERY",
      rateCard: {
        status: "ACTIVE",
        currency: quote.currency,
        version: snapshot.partnerRateCardVersion,
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
        agreement: {
          id: quote.partnerAgreementId,
          status: "ACTIVE",
          currency: quote.currency,
          effectiveFrom: { lte: now },
          AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
          partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        },
      },
    },
    include: { rateCard: { include: { agreement: { include: { partner: { select: { id: true } } } } } } },
  });
  if (rates.length !== rateSnapshots.length) return false;

  const byId = new Map(rates.map(rate => [rate.id, rate]));
  let transportTotal = 0n;
  for (const item of rateSnapshots) {
    const pkg = packages.find(value => value.id === item.packageId);
    const rate = byId.get(item.rateId);
    if (
      !pkg
      || !rate
      || rate.parcelCategory !== pkg.packageCategory
      || !rateFitsPackage(rate, pkg)
      || rate.transportChargeMinor.toString() !== item.transportChargeMinor
      || rate.rateCard.agreementId !== quote.partnerAgreementId
    ) return false;
    transportTotal += rate.transportChargeMinor;
  }
  return transportTotal.toString() === quote.transportChargeMinor.toString();
}

function quoteView(q) {
  return {
    id: q.id, parcelBookingId: q.parcelBookingId, version: q.version, status: q.status,
    currency: q.currency,
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
  clock = () => new Date(),
} = {}) {
  const router = Router();
  const admin = adminMiddleware;
  const customerQuotes = createCustomerShipmentQuotesService({ prismaClient, clock });
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

        // Serialize quote version allocation against concurrent quote creation and
        // fulfilment-path transitions for this booking.
        const now = new Date();
        const bookingLock = await tx.parcelBooking.updateMany({
          where: { id: booking.id, status: "DRAFT" },
          data: { updatedAt: now },
        });
        if (bookingLock.count !== 1) {
          return { conflict: "The booking changed while the partner quote was being issued." };
        }

        let rate = null;
        let manualAgreement = null;
        if (input.partnerRateId) {
          if (input.partnerAgreementId) return { invalidRate: true };
          rate = await tx.partnerRate.findFirst({
            where: {
              id: input.partnerRateId,
              ...buildPartnerRateEligibilityWhere(booking),
            },
            include: { rateCard: { include: { agreement: true } } },
          });
          if (!rate) return { invalidRate: true };
        } else {
          manualAgreement = await tx.partnerAgreement.findUnique({
            where: { id: input.partnerAgreementId },
            include: { partner: true },
          });
          if (!manualAgreement ||
            manualAgreement.status !== "ACTIVE" ||
            manualAgreement.partner.status !== "ACTIVE" ||
            manualAgreement.partner.verificationStatus !== "VERIFIED" ||
            manualAgreement.currency !== booking.currency ||
            manualAgreement.effectiveFrom > now ||
            (manualAgreement.effectiveUntil && manualAgreement.effectiveUntil <= now)) {
            return { invalidManualAgreement: true };
          }
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
          status: "OFFERED", partnerAgreementId: rate?.rateCard.agreementId ?? manualAgreement.id,
          partnerRateId: rate?.id ?? null, currency: rate?.rateCard.currency ?? manualAgreement.currency,
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
            partnerAgreementId: rate?.rateCard.agreementId ?? manualAgreement.id,
            partnerId: rate?.rateCard.agreement.partnerId ?? manualAgreement.partnerId,
            manualQuoteReason: rate ? null : input.reason,
          },
          expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000),
        } });
        return { quote };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (result.conflict) return res.status(409).json({ success: false, error: { code: "BOOKING_NOT_QUOTABLE", message: result.conflict } });
      if (result.invalidRate) return res.status(409).json({ success: false, error: { code: "PARTNER_RATE_UNAVAILABLE", message: "The selected rate is not active for this route and service." } });
      if (result.invalidManualAgreement) return res.status(409).json({ success: false, error: { code: "PARTNER_AGREEMENT_INELIGIBLE", message: "Manual transport charges must be tied to an active, verified partner agreement in the booking currency." } });
      if (result.invalidTransport) return res.status(400).json({ success: false, error: { code: "INVALID_TRANSPORT_CHARGE", message: "Transport charge must be greater than zero." } });
      return res.status(201).json({ success: true, data: { quote: quoteView(result.quote) } });
    } catch (error) { return next(error); }
  });

  router.post("/parcel-bookings/:bookingId/quotes", authMiddleware, asyncWrapper(async (req, res) => {
    const parsedId = id.safeParse(req.params.bookingId);
    if (!parsedId.success) return invalid(res, parsedId.error.issues);
    const parsed = customerQuoteInput.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const result = await customerQuotes.createQuote({
      bookingId: parsedId.data,
      userId: req.user.id,
      expiresInMinutes: parsed.data.expiresInMinutes,
    });
    if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
    if (result.forbidden) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot request a quote for this booking." } });
    if (result.conflict) return res.status(409).json({ success: false, error: result.conflict });
    return res.status(result.quote ? 201 : 200).json({ success: true, data: result });
  }));

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
      return res.status(200).json({ success: true, data: { items: quotes.map(customerQuoteView) } });
    } catch (error) { return next(error); }
  });

  router.post("/parcel-bookings/:bookingId/quotes/:quoteId/accept", authMiddleware, async (req, res, next) => {
    const bookingId = id.safeParse(req.params.bookingId);
    const quoteId = id.safeParse(req.params.quoteId);
    if (!bookingId.success || !quoteId.success) return invalid(res, [...(bookingId.success ? [] : bookingId.error.issues), ...(quoteId.success ? [] : quoteId.error.issues)]);
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const booking = await tx.parcelBooking.findUnique({
          where: { id: bookingId.data },
          include: { parcelPackages: { orderBy: { packageSequence: "asc" } } },
        });
        if (!booking) return { notFound: true };
        if (booking.senderId !== req.user.id) return { forbidden: true };
        const quote = await tx.shipmentQuote.findFirst({ where: { id: quoteId.data, parcelBookingId: booking.id } });
        if (!quote) return { quoteNotFound: true };
        if (quote.status === "ACCEPTED" && quote.acceptedByUserId === req.user.id) {
          const routePlan = await getExistingDeliveryRoutePlan({ tx, bookingId: booking.id });
          return { quote, routePlan, replay: true };
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
        const isPlatformRouteQuote = quote.inputSnapshot?.source === "PLATFORM_ROUTE_RATE";
        const isPartnerRouteQuote = quote.inputSnapshot?.source === "PARTNER_RATE_CARD";
        const isOperationalTripQuote = quote.inputSnapshot?.source === "ADMIN_OPERATIONAL_TRIP";
        if (isPlatformRouteQuote || isPartnerRouteQuote || isOperationalTripQuote) {
          const requiredZoneIds = [...new Set([booking.pickupServiceZoneId, booking.destinationServiceZoneId])];
          const activeZones = await tx.serviceZone.findMany({
            where: {
              id: { in: requiredZoneIds },
              isActive: true,
              state: { isActive: true, country: { isActive: true } },
              availability: {
                some: {
                  serviceType: "PARCEL_DELIVERY",
                  isEnabled: true,
                  AND: [
                    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                    { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
                  ],
                },
              },
            },
            select: { id: true },
          });
          if (activeZones.length !== requiredZoneIds.length) return { conflict: true, stalePricing: true };
        }
        if (isOperationalTripQuote && !await validateOperationalTripQuote(tx, booking, quote, now)) {
          return { conflict: true, stalePricing: true };
        }
        if (isPartnerRouteQuote) {
          const packages = (booking.parcelPackages ?? []).map(pkg => ({
            id: pkg.id,
            packageCategory: pkg.packageCategory,
            weightGrams: pkg.weightGrams,
            lengthMm: pkg.lengthMm,
            widthMm: pkg.widthMm,
            heightMm: pkg.heightMm,
          }));
          if (!await partnerRouteQuoteStillValid(tx, booking, quote, packages, now)) {
            return { conflict: true, stalePricing: true };
          }
        }
        if (isPlatformRouteQuote) {
          const packages = (booking.parcelPackages ?? []).map(pkg => ({
            id: pkg.id,
            externalPackageRef: pkg.externalPackageRef,
            packageCategory: pkg.packageCategory,
            weightGrams: pkg.weightGrams,
            lengthMm: pkg.lengthMm,
            widthMm: pkg.widthMm,
            heightMm: pkg.heightMm,
          }));
          const current = await assessPlatformRouteTariffs({
            tx,
            originServiceZoneId: booking.pickupServiceZoneId,
            destinationServiceZoneId: booking.destinationServiceZoneId,
            packages,
            currency: quote.currency,
            now,
            routeSnapshot: quote.inputSnapshot.routeSnapshot,
            expiresAt: quote.expiresAt,
          });
          const currentOption = current.status === "QUOTED" ? current.options[0] : null;
          const originalRates = quote.inputSnapshot.packageRateSnapshot ?? [];
          const currentRates = currentOption?.rateSnapshot ?? [];
          const rateKey = rates => rates.map(rate => `${rate.packageRef}:${rate.rateId}:${rate.rateVersion}`).sort().join("|");
          if (
            !currentOption
            || currentOption.customerCharge.toString() !== quote.totalCustomerChargeMinor.toString()
            || currentOption.platformCharge.toString() !== quote.platformChargeMinor.toString()
            || currentOption.driverPayout.toString() !== String(quote.inputSnapshot.driverPayoutMinor)
            || rateKey(currentRates) !== rateKey(originalRates)
          ) {
            return { conflict: true, stalePricing: true };
          }
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
        const nextBookingStatus = isPlatformRouteQuote || isOperationalTripQuote ? "AWAITING_PARTNER_ASSIGNMENT" : "AWAITING_PAYMENT";
        const bookingUpdate = await tx.parcelBooking.updateMany({
          where: {
            id: booking.id,
            senderId: req.user.id,
            status: "DRAFT",
          },
          data: {
            customerPayableMinor: quote.totalCustomerChargeMinor,
            connectionFeeMinor: quote.platformChargeMinor,
            otherChargesMinor: quote.otherChargesMinor + quote.collectionChargeMinor + quote.hubHandlingChargeMinor + quote.destinationDeliveryChargeMinor,
            pricingSnapshot: {
              source: quote.inputSnapshot?.source ?? null,
              quoteId: quote.id,
              quoteVersion: quote.version,
              currency: quote.currency,
              totalCustomerChargeMinor: quote.totalCustomerChargeMinor.toString(),
              ...((isPlatformRouteQuote || isOperationalTripQuote) && quote.inputSnapshot?.driverPayoutMinor != null ? { driverPayoutMinor: String(quote.inputSnapshot.driverPayoutMinor) } : {}),
              chargeBreakdown: quote.chargeBreakdown,
              acceptedAt: now.toISOString(),
            },
            status: nextBookingStatus,
          },
        });
        if (bookingUpdate.count !== 1) {
          const error = new Error("The booking has already moved beyond quote acceptance.");
          error.statusCode = 409;
          error.code = "BOOKING_NOT_QUOTABLE";
          throw error;
        }
        const routePlan = await createMultiLegPlan({ tx, booking, quote, now });
        await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            actorUserId: req.user.id,
            eventType: "SHIPMENT_QUOTE_ACCEPTED",
            fromStatus: booking.status,
            toStatus: nextBookingStatus,
            metadata: {
              quoteId: quote.id,
              quoteVersion: quote.version,
              totalCustomerChargeMinor: quote.totalCustomerChargeMinor.toString(),
              currency: quote.currency,
              routeMode: routePlan.routeMode,
              deliveryLegIds: routePlan.legs.map((leg) => leg.id),
              originHubPointId: routePlan.originHub?.id ?? null,
              destinationHubPointId: routePlan.destinationHub?.id ?? null,
            },
          },
        });
        return {
          quote: await tx.shipmentQuote.findUnique({ where: { id: quote.id } }),
          routePlan,
        };
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Parcel booking not found." } });
      if (result.quoteNotFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Quote not found for this booking." } });
      if (result.forbidden) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot accept this quote." } });
      if (result.conflict) return res.status(409).json({ success: false, error: {
        code: result.stalePricing ? "QUOTE_PRICING_CHANGED" : "QUOTE_NOT_ACCEPTABLE",
        message: result.stalePricing ? "Route availability or tariff terms changed after this quote was issued. Request a fresh quote." : "This quote is no longer available or has expired.",
      } });
      return res.status(200).json({ success: true, data: {
        quote: customerQuoteView(result.quote),
        routePlan: result.routePlan ?? null,
        replay: result.replay === true,
      } });
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
