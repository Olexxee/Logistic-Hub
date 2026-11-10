import { resolveDeliveryRoute } from "../delivery-legs/delivery-route-planner.js";
import { assessPlatformRouteTariffs, rateFitsPackage } from "../platform-route-pricing/platform-route-tariff-assessment.service.js";

function conflict(code, message) {
  return { conflict: { code, message } };
}

function routeSnapshotFor(booking, route) {
  return {
    routeMode: route.routeMode,
    origin: route.origin,
    destination: route.destination,
    hubAssisted: route.routeMode === "HUB_ASSISTED",
    originHub: route.originHub,
    destinationHub: route.destinationHub,
    legs: route.legs.map(leg => ({
      sequence: leg.sequence,
      type: leg.type,
      originServiceZoneId: leg.originServiceZoneId,
      destinationServiceZoneId: leg.destinationServiceZoneId,
      originHubPointId: leg.originHubPointId ?? null,
      destinationHubPointId: leg.destinationHubPointId ?? null,
      origin: { latitude: Number(leg.originLatitude), longitude: Number(leg.originLongitude) },
      destination: { latitude: Number(leg.destinationLatitude), longitude: Number(leg.destinationLongitude) },
    })),
    routePlanVersion: 1,
  };
}

function packageFacts(booking) {
  return (booking.parcelPackages ?? []).map(pkg => ({
    id: pkg.id,
    externalPackageRef: pkg.externalPackageRef,
    packageCategory: pkg.packageCategory,
    weightGrams: pkg.weightGrams,
    lengthMm: pkg.lengthMm,
    widthMm: pkg.widthMm,
    heightMm: pkg.heightMm,
  }));
}

async function assessEndToEndPartnerRates(tx, { booking, packages, routeSnapshot, now, expiresAt }) {
  if (packages.some(pkg => !Number.isInteger(pkg.weightGrams) || pkg.weightGrams <= 0)) {
    return {
      status: "REQUIRES_MEASUREMENT",
      reason: "Every package needs a declared or measured weight before a contracted rate can be matched. No estimated weight is generated.",
      options: [],
    };
  }

  const pricingRules = await tx.pricingRule.findMany({
    where: {
      serviceType: "PARCEL_DELIVERY",
      isActive: true,
      currency: booking.currency,
      effectiveFrom: { lte: now },
      AND: [
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
        { OR: [{ serviceZoneId: booking.pickupServiceZoneId }, { serviceZoneId: null }] },
      ],
    },
    orderBy: [{ serviceZoneId: "desc" }, { version: "desc" }],
  });
  const pricingRule = pricingRules.find(rule => rule.serviceZoneId === booking.pickupServiceZoneId)
    ?? pricingRules.find(rule => rule.serviceZoneId == null);
  if (!pricingRule) {
    return {
      status: "REQUIRES_OPERATIONAL_PRICING",
      reason: "A platform charge has not been configured for this contracted route.",
      options: [],
    };
  }

  const rates = await tx.partnerRate.findMany({
    where: {
      originServiceZoneId: booking.pickupServiceZoneId,
      destinationServiceZoneId: booking.destinationServiceZoneId,
      serviceType: "PARCEL_DELIVERY",
      isActive: true,
      parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory))] },
      rateCard: {
        status: "ACTIVE",
        currency: booking.currency,
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
        agreement: {
          status: "ACTIVE",
          currency: booking.currency,
          effectiveFrom: { lte: now },
          AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
          partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        },
      },
    },
    include: {
      rateCard: {
        include: {
          agreement: { include: { partner: { select: { id: true, displayName: true } } } },
        },
      },
    },
    orderBy: [{ rateCardId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  const byCard = new Map();
  for (const rate of rates) {
    const cardRates = byCard.get(rate.rateCardId) ?? [];
    cardRates.push(rate);
    byCard.set(rate.rateCardId, cardRates);
  }

  const candidates = [];
  for (const [rateCardId, cardRates] of byCard) {
    const matched = [];
    let valid = true;
    for (let index = 0; index < packages.length; index += 1) {
      const pkg = packages[index];
      const matches = cardRates.filter(rate => rate.parcelCategory === pkg.packageCategory && rateFitsPackage(rate, pkg));
      if (matches.length !== 1) {
        valid = false;
        break;
      }
      matched.push({
        packageSequence: index + 1,
        packageId: pkg.id,
        rate: matches[0],
      });
    }
    if (!valid) continue;
    const transport = matched.reduce((sum, item) => sum + item.rate.transportChargeMinor, 0n);
    const platform = pricingRule.fixedConnectionFeeMinor;
    candidates.push({
      rateCardId,
      agreementId: cardRates[0].rateCard.agreementId,
      partnerId: cardRates[0].rateCard.agreement.partnerId,
      partnerName: cardRates[0].rateCard.agreement.partner.displayName,
      partnerRateId: matched[0].rate.id,
      transport,
      platform,
      total: transport + platform,
      rateCardVersion: cardRates[0].rateCard.version,
      packageRateSnapshot: matched.map(item => ({
        packageSequence: item.packageSequence,
        packageId: item.packageId,
        rateId: item.rate.id,
        transportChargeMinor: item.rate.transportChargeMinor.toString(),
        estimatedTransitMinutes: item.rate.estimatedTransitMinutes,
      })),
      estimatedTransitMinutes: matched.map(item => item.rate.estimatedTransitMinutes)
        .filter(Number.isInteger).reduce((max, value) => Math.max(max, value), 0) || null,
    });
  }

  candidates.sort((a, b) => a.total < b.total ? -1 : a.total > b.total ? 1 : a.rateCardId.localeCompare(b.rateCardId));
  if (!candidates.length) {
    return {
      status: "NO_COVERAGE",
      reason: "No single active verified partner rate card covers every package on this directed corridor.",
      options: [],
    };
  }
  const selected = candidates[0];
  return {
    status: "QUOTED",
    reason: null,
    options: [{
      source: "PARTNER_RATE_CARD",
      partnerAgreementId: selected.agreementId,
      partnerRateId: selected.partnerRateId,
      currency: booking.currency,
      transportChargeMinor: selected.transport,
      platformChargeMinor: selected.platform,
      totalCustomerChargeMinor: selected.total,
      estimatedTransitMinutes: selected.estimatedTransitMinutes,
      packageRateSnapshot: selected.packageRateSnapshot,
      routeSnapshot,
      expiresAt,
      inputSnapshot: {
        source: "PARTNER_RATE_CARD",
        routeSnapshot,
        partnerId: selected.partnerId,
        partnerName: selected.partnerName,
        partnerRateCardId: selected.rateCardId,
        partnerRateCardVersion: selected.rateCardVersion,
        partnerRateSnapshots: selected.packageRateSnapshot,
        pricingRuleId: pricingRule.id,
        pricingRuleVersion: pricingRule.version,
      },
    }],
  };
}

async function serializable(prismaClient, work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prismaClient.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

export function customerQuoteView(quote) {
  return {
    id: quote.id,
    parcelBookingId: quote.parcelBookingId,
    version: quote.version,
    status: quote.status,
    currency: quote.currency,
    transportChargeMinor: quote.transportChargeMinor.toString(),
    collectionChargeMinor: quote.collectionChargeMinor.toString(),
    hubHandlingChargeMinor: quote.hubHandlingChargeMinor.toString(),
    destinationDeliveryChargeMinor: quote.destinationDeliveryChargeMinor.toString(),
    platformChargeMinor: quote.platformChargeMinor.toString(),
    otherChargesMinor: quote.otherChargesMinor.toString(),
    totalCustomerChargeMinor: quote.totalCustomerChargeMinor.toString(),
    chargeBreakdown: quote.chargeBreakdown,
    expiresAt: quote.expiresAt,
    offeredAt: quote.offeredAt,
    acceptedAt: quote.acceptedAt,
  };
}

export function createCustomerShipmentQuotesService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async createQuote({ bookingId, userId, expiresInMinutes = 15 }) {
      const now = clock();
      const expiresAt = new Date(now.getTime() + expiresInMinutes * 60_000);
      return serializable(prismaClient, async tx => {
        const booking = await tx.parcelBooking.findUnique({
          where: { id: bookingId },
          include: { parcelPackages: { orderBy: { packageSequence: "asc" } } },
        });
        if (!booking) return { notFound: true };
        if (booking.senderId !== userId) return { forbidden: true };
        if (booking.status !== "DRAFT") return conflict("BOOKING_NOT_QUOTABLE", "A quote can only be requested for a draft booking.");

        const packages = packageFacts(booking);
        if (!packages.length) return conflict("PACKAGE_FACTS_REQUIRED", "Package facts are required before a delivery quote can be assessed.");

        const lock = await tx.parcelBooking.updateMany({
          where: { id: booking.id, senderId: userId, status: "DRAFT" },
          data: { updatedAt: now },
        });
        if (lock.count !== 1) return conflict("BOOKING_NOT_QUOTABLE", "The booking changed while its quote was being assessed.");

        const route = await resolveDeliveryRoute({ tx, booking: { ...booking, packages } });
        const routeSnapshot = routeSnapshotFor(booking, route);
        if (route.routeMode === "HUB_ASSISTED") {
          return {
            assessment: {
              status: "REQUIRES_OPERATIONAL_PRICING",
              routeMode: route.routeMode,
              packageCount: packages.length,
              reason: "This route requires separately approved pickup, inter-hub transport, hub handling and final-mile charges.",
              assessedAt: now.toISOString(),
            },
            quote: null,
          };
        }

        let assessment;
        let candidate;
        if (route.routeMode === "LOCAL_DIRECT") {
          const result = await assessPlatformRouteTariffs({
            tx,
            originServiceZoneId: booking.pickupServiceZoneId,
            destinationServiceZoneId: booking.destinationServiceZoneId,
            packages,
            currency: booking.currency,
            now,
            routeSnapshot,
            expiresAt,
          });
          assessment = result.assessment;
          if (result.status !== "QUOTED") {
            return { assessment: { ...assessment, status: result.status }, quote: null };
          }
          const option = result.options[0];
          candidate = {
            source: "PLATFORM_ROUTE_RATE",
            partnerAgreementId: null,
            partnerRateId: null,
            currency: option.currency,
            transportChargeMinor: option.logisticsCost,
            platformChargeMinor: option.platformCharge,
            totalCustomerChargeMinor: option.customerCharge,
            estimatedTransitMinutes: option.estimatedTransitMinutes,
            packageRateSnapshot: option.rateSnapshot,
            routeSnapshot,
            expiresAt,
            inputSnapshot: {
              source: "PLATFORM_ROUTE_RATE",
              routeSnapshot,
              driverPayoutMinor: option.driverPayout.toString(),
              packageRateSnapshot: option.rateSnapshot,
              assessmentSnapshot: assessment,
            },
          };
        } else {
          const result = await assessEndToEndPartnerRates(tx, { booking, packages, routeSnapshot, now, expiresAt });
          if (result.status !== "QUOTED") {
            return {
              assessment: {
                status: result.status,
                routeMode: route.routeMode,
                packageCount: packages.length,
                reason: result.reason,
                routeSnapshot,
                assessedAt: now.toISOString(),
              },
              quote: null,
            };
          }
          candidate = result.options[0];
          assessment = {
            status: "DECLARED",
            source: "PARTNER_RATE_CARD",
            operationalPlanStatus: "FULLY_PRICED",
            routeMode: route.routeMode,
            packageCount: packages.length,
            routeSnapshot,
            assessedAt: now.toISOString(),
          };
        }

        const previous = await tx.shipmentQuote.findFirst({
          where: { parcelBookingId: booking.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        await tx.shipmentQuote.updateMany({
          where: { parcelBookingId: booking.id, status: "OFFERED" },
          data: { status: "SUPERSEDED" },
        });

        const transport = candidate.transportChargeMinor;
        const platform = candidate.platformChargeMinor;
        const total = candidate.totalCustomerChargeMinor;
        const quote = await tx.shipmentQuote.create({
          data: {
            parcelBookingId: booking.id,
            version: (previous?.version ?? 0) + 1,
            status: "OFFERED",
            partnerAgreementId: candidate.partnerAgreementId,
            partnerRateId: candidate.partnerRateId,
            currency: candidate.currency,
            transportChargeMinor: transport,
            collectionChargeMinor: 0n,
            hubHandlingChargeMinor: 0n,
            destinationDeliveryChargeMinor: 0n,
            platformChargeMinor: platform,
            otherChargesMinor: 0n,
            totalCustomerChargeMinor: total,
            chargeBreakdown: {
              transportChargeMinor: transport.toString(),
              collectionChargeMinor: "0",
              hubHandlingChargeMinor: "0",
              destinationDeliveryChargeMinor: "0",
              platformChargeMinor: platform.toString(),
              otherChargesMinor: "0",
              estimatedTransitMinutes: candidate.estimatedTransitMinutes,
            },
            inputSnapshot: {
              ...candidate.inputSnapshot,
              routeSnapshot,
              assessmentSnapshot: assessment,
            },
            expiresAt,
          },
        });
        return {
          assessment: {
            status: "QUOTED",
            source: candidate.source,
            routeMode: route.routeMode,
            packageCount: packages.length,
            estimatedTransitMinutes: candidate.estimatedTransitMinutes,
            assessedAt: now.toISOString(),
          },
          quote: customerQuoteView(quote),
        };
      });
    },
  };
}
