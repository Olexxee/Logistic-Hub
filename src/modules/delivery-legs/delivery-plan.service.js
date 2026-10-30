function distanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(latitudeB - latitudeA);
  const dLon = radians(longitudeB - longitudeA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function eligibleHub(hub, parcelCategory) {
  const accepted = Array.isArray(hub.acceptedParcelTypes) ? hub.acceptedParcelTypes : [];
  const capacity = hub.capacityConfig && typeof hub.capacityConfig === "object"
    ? hub.capacityConfig.maxParcels
    : null;
  return accepted.includes(parcelCategory) && Number.isInteger(capacity) && capacity > 0;
}

function nearestHub(hubs, zoneId, parcelCategory, latitude, longitude) {
  return hubs
    .filter((hub) => hub.serviceZoneId === zoneId && eligibleHub(hub, parcelCategory))
    .sort((a, b) => distanceMeters(latitude, longitude, Number(a.latitude), Number(a.longitude))
      - distanceMeters(latitude, longitude, Number(b.latitude), Number(b.longitude)))[0] ?? null;
}

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
 * Creates the ordered execution plan for an accepted inter-state quote.
 * If suitable verified hubs exist at both ends, the plan uses pickup, trunk and final-mile legs.
 * Otherwise, it records an end-to-end transport leg instead of inventing hub stops.
 */
export async function createMultiLegPlan({ tx, booking, quote, now = new Date() }) {
  if (!tx || !booking || !quote) throw new Error("A transaction, booking and accepted quote are required.");

  const zones = await tx.serviceZone.findMany({
    where: { id: { in: [booking.pickupServiceZoneId, booking.destinationServiceZoneId] } },
    select: { id: true, stateId: true },
  });
  if (zones.length !== 2) {
    const error = new Error("Both route service zones must exist before a delivery plan can be created.");
    error.statusCode = 409;
    error.code = "DELIVERY_ROUTE_ZONES_INVALID";
    throw error;
  }
  const stateByZone = new Map(zones.map((zone) => [zone.id, zone.stateId]));
  if (stateByZone.get(booking.pickupServiceZoneId) === stateByZone.get(booking.destinationServiceZoneId)) {
    return { routeMode: "LOCAL_DIRECT", legs: [] };
  }

  const hubs = await tx.hubPoint.findMany({
    where: {
      serviceZoneId: { in: [booking.pickupServiceZoneId, booking.destinationServiceZoneId] },
      status: "ACTIVE",
      operatorVerificationStatus: "VERIFIED",
    },
    select: {
      id: true, name: true, serviceZoneId: true, latitude: true, longitude: true,
      acceptedParcelTypes: true, capacityConfig: true,
    },
  });
  const originHub = nearestHub(
    hubs, booking.pickupServiceZoneId, booking.parcelCategory,
    Number(booking.pickupLatitude), Number(booking.pickupLongitude),
  );
  const destinationHub = nearestHub(
    hubs, booking.destinationServiceZoneId, booking.parcelCategory,
    Number(booking.destinationLatitude), Number(booking.destinationLongitude),
  );

  let routeMode;
  let definitions;
  if (originHub && destinationHub) {
    routeMode = "HUB_ASSISTED";
    definitions = [
      {
        sequence: 1, type: "LOCAL_PICKUP", status: "READY_FOR_ASSIGNMENT",
        originServiceZoneId: booking.pickupServiceZoneId,
        destinationServiceZoneId: booking.pickupServiceZoneId,
        destinationHubPointId: originHub.id,
        originLatitude: booking.pickupLatitude, originLongitude: booking.pickupLongitude,
        destinationLatitude: originHub.latitude, destinationLongitude: originHub.longitude,
      },
      {
        sequence: 2, type: "INTERSTATE_TRANSPORT", status: "PLANNED",
        originServiceZoneId: booking.pickupServiceZoneId,
        destinationServiceZoneId: booking.destinationServiceZoneId,
        originHubPointId: originHub.id, destinationHubPointId: destinationHub.id,
        originLatitude: originHub.latitude, originLongitude: originHub.longitude,
        destinationLatitude: destinationHub.latitude, destinationLongitude: destinationHub.longitude,
      },
      {
        sequence: 3, type: "FINAL_MILE", status: "PLANNED",
        originServiceZoneId: booking.destinationServiceZoneId,
        destinationServiceZoneId: booking.destinationServiceZoneId,
        originHubPointId: destinationHub.id,
        originLatitude: destinationHub.latitude, originLongitude: destinationHub.longitude,
        destinationLatitude: booking.destinationLatitude, destinationLongitude: booking.destinationLongitude,
      },
    ];
  } else {
    routeMode = "END_TO_END";
    definitions = [{
      sequence: 1, type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
      originServiceZoneId: booking.pickupServiceZoneId,
      destinationServiceZoneId: booking.destinationServiceZoneId,
      originLatitude: booking.pickupLatitude, originLongitude: booking.pickupLongitude,
      destinationLatitude: booking.destinationLatitude, destinationLongitude: booking.destinationLongitude,
    }];
  }

  const legs = [];
  for (const definition of definitions) {
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
    routeMode,
    originHub: originHub ? { id: originHub.id, name: originHub.name } : null,
    destinationHub: destinationHub ? { id: destinationHub.id, name: destinationHub.name } : null,
    legs,
  };
}
