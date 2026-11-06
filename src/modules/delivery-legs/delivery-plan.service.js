import { resolveDeliveryRoute } from "./delivery-route-planner.js";

function legData({
  parcelBookingId, sequence, type, status, originServiceZoneId, destinationServiceZoneId,
  originHubPointId = null, destinationHubPointId = null,
  originLatitude, originLongitude, destinationLatitude, destinationLongitude,
  quoteId, now,
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
    metadata: { quoteId, routePlanVersion: 1 },
  };
}

/**
 * Creates the execution legs from the same route resolver used by integration quoting.
 * A persisted END_TO_END quote pins its one-leg topology even if hubs become eligible later.
 */
export async function createMultiLegPlan({ tx, booking, quote, now = new Date() }) {
  if (!tx || !booking || !quote) throw new Error("A transaction, booking and accepted quote are required.");

  const quoteRoute = quote.inputSnapshot?.routeSnapshot ?? quote.routeSnapshot ?? null;
  const plan = await resolveDeliveryRoute({
    tx,
    booking,
    routeModeOverride: quoteRoute?.routeMode === "END_TO_END" ? "END_TO_END" : undefined,
  });

  const legs = [];
  for (const definition of plan.legs) {
    const leg = await tx.deliveryLeg.create({
      data: legData({
        parcelBookingId: booking.id,
        quoteId: quote.id,
        now,
        ...definition,
      }),
      select: {
        id: true, sequence: true, type: true, status: true,
        originServiceZoneId: true, destinationServiceZoneId: true,
        originHubPointId: true, destinationHubPointId: true,
      },
    });
    legs.push(leg);
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
  return {
    routeMode: hubAssisted ? "HUB_ASSISTED" : "END_TO_END",
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
