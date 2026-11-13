import { resolveDeliveryRoute } from "./delivery-route-planner.js";

function quotePricingSource(quote, driverPayoutMinor) {
  if (quote.inputSnapshot?.source === "PLATFORM_OPERATIONAL_TARIFF") return "PLATFORM_OPERATIONAL_TARIFF";
  return driverPayoutMinor != null ? "PLATFORM_ROUTE_RATE" : "CONTRACTED_PARTNER_RATE";
}

function legData({
  parcelBookingId, sequence, type, status, originServiceZoneId, destinationServiceZoneId,
  originHubPointId = null, destinationHubPointId = null,
  originLatitude, originLongitude, destinationLatitude, destinationLongitude,
  quoteId, driverPayoutMinor = null, operationalLeg = null, now,
}) {
  return {
    parcelBookingId,
    sequence,
    type,
    status,
    originServiceZoneId,
    destinationServiceZoneId,
    originHubPointId,
    destinationHubPointId,
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
    plannedAt: now,
    ...(status === "ASSIGNED" ? { assignedAt: now } : {}),
    metadata: operationalLeg ? {
      quoteId, routePlanVersion: 1, pricingSource: "ADMIN_OPERATIONAL_TRIP",
      executionType: operationalLeg.executionType,
      driverPayoutMinor: operationalLeg.driverPayoutMinor ?? null,
      payeeName: operationalLeg.payeeName ?? null,
      payeePhone: operationalLeg.payeePhone ?? null,
      partnerId: operationalLeg.partnerId ?? null, agreementId: operationalLeg.agreementId ?? null,
      executionCostMinor: operationalLeg.executionCostMinor ?? null,
      customerChargeMinor: operationalLeg.customerChargeMinor,
    } : {
      quoteId, routePlanVersion: 1, driverPayoutMinor,
      pricingSource: quotePricingSource(quote, driverPayoutMinor),
      ...(quote.inputSnapshot?.source === "PLATFORM_OPERATIONAL_TARIFF" ? {
        requiresOperationalReview: true,
        executionReadiness: "NOT_ASSESSED",
        executionReviewReason: "EXECUTION_ACTOR_AND_COST_NOT_RESOLVED",
      } : {}),
    },
  };
}

/**
 * Creates the execution legs from the same route resolver used by integration quoting.
 * A persisted END_TO_END quote pins its one-leg topology even if hubs become eligible later.
 */
export async function createMultiLegPlan({ tx, booking, quote, actorUserId, now = new Date() }) {
  if (!tx || !booking || !quote) throw new Error("A transaction, booking and accepted quote are required.");

  const quoteRoute = quote.inputSnapshot?.routeSnapshot ?? quote.routeSnapshot ?? null;
  const plan = await resolveDeliveryRoute({
    tx,
    booking,
    routeModeOverride: ["END_TO_END", "LOCAL_DIRECT"].includes(quoteRoute?.routeMode) ? quoteRoute.routeMode : undefined,
  });

  const legs = [];
  const operationalLegs = quote.inputSnapshot?.source === "ADMIN_OPERATIONAL_TRIP" ? quote.inputSnapshot.operationalLegs : null;
  const definitions = operationalLegs
    ? operationalLegs.map(leg => ({
      ...leg, status: leg.executionType === "PLATFORM_MANAGED_DRIVER" ? "ASSIGNED" : "READY_FOR_ASSIGNMENT",
      originLatitude: leg.origin?.latitude ?? booking.pickupLatitude,
      originLongitude: leg.origin?.longitude ?? booking.pickupLongitude,
      destinationLatitude: leg.destination?.latitude ?? booking.destinationLatitude,
      destinationLongitude: leg.destination?.longitude ?? booking.destinationLongitude,
    }))
    : quoteRoute?.routeMode === "LOCAL_DIRECT"
      ? [{
        sequence: 1, type: "LOCAL_PICKUP", status: "READY_FOR_ASSIGNMENT",
        originServiceZoneId: booking.pickupServiceZoneId,
        destinationServiceZoneId: booking.destinationServiceZoneId,
        originLatitude: booking.pickupLatitude, originLongitude: booking.pickupLongitude,
        destinationLatitude: booking.destinationLatitude, destinationLongitude: booking.destinationLongitude,
      }]
      : plan.legs;
  for (const definition of definitions) {
    const pricingPendingExecutionReview = quote.inputSnapshot?.source === "PLATFORM_OPERATIONAL_TARIFF";
    const leg = await tx.deliveryLeg.create({
      data: legData({
        parcelBookingId: booking.id,
        quoteId: quote.id,
        driverPayoutMinor: operationalLegs ? definition.driverPayoutMinor ?? null : quote.inputSnapshot?.driverPayoutMinor ?? null,
        operationalLeg: operationalLegs ? definition : null,
        now,
        ...definition,
        ...(pricingPendingExecutionReview ? { status: "PLANNED" } : {}),
      }),
      select: {
        id: true, sequence: true, type: true, status: true,
        originServiceZoneId: true, destinationServiceZoneId: true,
        originHubPointId: true, destinationHubPointId: true,
      },
    });
    legs.push(leg);
    if (operationalLegs && definition.executionType === "PLATFORM_MANAGED_DRIVER") {
      await tx.manualOperationalSettlement.create({ data: {
        deliveryLegId: leg.id,
        payeeName: definition.payeeName,
        payeePhone: definition.payeePhone ?? null,
        amountMinor: BigInt(definition.driverPayoutMinor),
        currency: quote.currency,
        reason: quote.inputSnapshot.reason,
        createdByUserId: actorUserId,
      } });
    }
  }

  return {
    routeMode: plan.routeMode,
    originHub: plan.originHub,
    destinationHub: plan.destinationHub,
    legs,
  };
}

export async function getExistingDeliveryRoutePlan({ tx, bookingId }) {
  const legs = await tx.deliveryLeg.findMany({
    where: { parcelBookingId: bookingId },
    orderBy: { sequence: "asc" },
    include: {
      originHubPoint: { select: { id: true, name: true } },
      destinationHubPoint: { select: { id: true, name: true } },
    },
  });
  if (legs.length === 0) return { routeMode: "LOCAL_DIRECT", originHub: null, destinationHub: null, legs: [] };
  const hubAssisted = legs.some((leg) => leg.type === "LOCAL_PICKUP")
    && legs.some((leg) => leg.type === "FINAL_MILE");
  const localDirect = legs.length === 1
    && legs[0].type === "LOCAL_PICKUP"
    && !legs[0].originHubPointId
    && !legs[0].destinationHubPointId;
  return {
    routeMode: localDirect ? "LOCAL_DIRECT" : hubAssisted ? "HUB_ASSISTED" : "END_TO_END",
    originHub: legs.find((leg) => leg.type === "LOCAL_PICKUP")?.destinationHubPoint
      ?? legs.find((leg) => leg.originHubPoint)?.originHubPoint
      ?? null,
    destinationHub: legs.find((leg) => leg.type === "FINAL_MILE")?.originHubPoint
      ?? legs.find((leg) => leg.destinationHubPoint)?.destinationHubPoint
      ?? null,
    legs: legs.map((leg) => ({
      id: leg.id,
      sequence: leg.sequence,
      type: leg.type,
      status: leg.status,
      originServiceZoneId: leg.originServiceZoneId,
      destinationServiceZoneId: leg.destinationServiceZoneId,
      originHubPointId: leg.originHubPointId,
      destinationHubPointId: leg.destinationHubPointId,
    })),
  };
}
