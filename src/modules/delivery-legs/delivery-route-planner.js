function distanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(latitudeB - latitudeA);
  const dLon = radians(longitudeB - longitudeA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function packageFacts(booking) {
  if (Array.isArray(booking.packages) && booking.packages.length) return booking.packages;
  return [{ packageCategory: booking.parcelCategory }];
}

function eligibleHub(hub, packages) {
  const accepted = Array.isArray(hub.acceptedParcelTypes) ? hub.acceptedParcelTypes : [];
  const capacity = hub.capacityConfig && typeof hub.capacityConfig === "object"
    ? hub.capacityConfig.maxParcels
    : null;
  return Number.isInteger(capacity)
    && capacity >= packages.length
    && packages.every((pkg) => accepted.includes(pkg.packageCategory));
}

function nearestHub(hubs, zoneId, packages, latitude, longitude) {
  return hubs
    .filter((hub) => hub.serviceZoneId === zoneId && eligibleHub(hub, packages))
    .sort((a, b) => distanceMeters(latitude, longitude, Number(a.latitude), Number(a.longitude))
      - distanceMeters(latitude, longitude, Number(b.latitude), Number(b.longitude)))[0] ?? null;
}

function invalidPinnedRoute() {
  const error = new Error("The accepted hub-assisted route no longer matches an active, eligible pair of hubs.");
  error.statusCode = 409;
  error.code = "DELIVERY_ROUTE_SNAPSHOT_INVALID";
  return error;
}

async function resolvePinnedHubAssistedRoute({ tx, booking, routeSnapshot, zones, origin, destination, now }) {
  const legs = routeSnapshot?.legs;
  if (!Array.isArray(legs) || legs.length !== 3) throw invalidPinnedRoute();
  const [pickup, transfer, finalMile] = legs;
  const originHubPointId = pickup.destinationHubPointId;
  const destinationHubPointId = finalMile.originHubPointId;
  const coordinates = legs.flatMap(leg => [
    leg.origin?.latitude, leg.origin?.longitude,
    leg.destination?.latitude, leg.destination?.longitude,
  ]);
  const validCoordinates = coordinates.every(Number.isFinite);
  const validTopology = routeSnapshot.routeMode === "HUB_ASSISTED"
    && validCoordinates
    && pickup.sequence === 1 && pickup.type === "LOCAL_PICKUP"
    && transfer.sequence === 2 && transfer.type === "INTERSTATE_TRANSPORT"
    && finalMile.sequence === 3 && finalMile.type === "FINAL_MILE"
    && pickup.originServiceZoneId === booking.pickupServiceZoneId
    && pickup.destinationServiceZoneId === booking.pickupServiceZoneId
    && transfer.originServiceZoneId === booking.pickupServiceZoneId
    && transfer.destinationServiceZoneId === booking.destinationServiceZoneId
    && finalMile.originServiceZoneId === booking.destinationServiceZoneId
    && finalMile.destinationServiceZoneId === booking.destinationServiceZoneId
    && typeof originHubPointId === "string" && originHubPointId.length > 0
    && typeof destinationHubPointId === "string" && destinationHubPointId.length > 0
    && originHubPointId !== destinationHubPointId
    && pickup.originHubPointId == null
    && transfer.originHubPointId === originHubPointId
    && transfer.destinationHubPointId === destinationHubPointId
    && finalMile.destinationHubPointId == null;
  if (!validTopology) throw invalidPinnedRoute();

  const hubIds = [originHubPointId, destinationHubPointId];
  const hubs = await tx.hubPoint.findMany({
    where: {
      id: { in: hubIds },
      status: "ACTIVE",
      operatorVerificationStatus: "VERIFIED",
      serviceZone: {
        isActive: true,
        state: { isActive: true, country: { isActive: true } },
        availability: {
          some: {
            serviceType: "PARCEL_DELIVERY",
            isEnabled: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
          },
        },
      },
    },
    select: {
      id: true, name: true, serviceZoneId: true,
      acceptedParcelTypes: true, capacityConfig: true,
    },
  });
  if (hubs.length !== 2) throw invalidPinnedRoute();
  const originHub = hubs.find(hub => hub.id === originHubPointId);
  const destinationHub = hubs.find(hub => hub.id === destinationHubPointId);
  const packages = packageFacts(booking);
  if (!originHub || !destinationHub
    || originHub.serviceZoneId !== booking.pickupServiceZoneId
    || destinationHub.serviceZoneId !== booking.destinationServiceZoneId
    || ![originHub, destinationHub].every(hub => eligibleHub(hub, packages))) {
    throw invalidPinnedRoute();
  }

  return {
    routeMode: "HUB_ASSISTED",
    originHub: { id: originHub.id, name: originHub.name },
    destinationHub: { id: destinationHub.id, name: destinationHub.name },
    zones, origin, destination,
    legs: legs.map(leg => ({
      sequence: leg.sequence,
      type: leg.type,
      status: "PLANNED",
      originServiceZoneId: leg.originServiceZoneId,
      destinationServiceZoneId: leg.destinationServiceZoneId,
      originHubPointId: leg.originHubPointId ?? null,
      destinationHubPointId: leg.destinationHubPointId ?? null,
      originLatitude: leg.origin?.latitude,
      originLongitude: leg.origin?.longitude,
      destinationLatitude: leg.destination?.latitude,
      destinationLongitude: leg.destination?.longitude,
    })),
  };
}

export async function resolveDeliveryRoute({ tx, booking, routeModeOverride, routeSnapshot, now = new Date() }) {
  if (!tx || !booking) throw new Error("A transaction and booking are required.");

  const zoneIds = [...new Set([booking.pickupServiceZoneId, booking.destinationServiceZoneId])];
  const zones = await tx.serviceZone.findMany({
    where: { id: { in: zoneIds }, isActive: true },
    select: { id: true, code: true, name: true, stateId: true },
  });
  if (zones.length !== zoneIds.length) {
    const error = new Error("Both route service zones must exist and be active before a delivery plan can be created.");
    error.statusCode = 409;
    error.code = "DELIVERY_ROUTE_ZONES_INVALID";
    throw error;
  }

  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const sameState = zoneById.get(booking.pickupServiceZoneId).stateId
    === zoneById.get(booking.destinationServiceZoneId).stateId;
  const origin = {
    serviceZoneId: booking.pickupServiceZoneId,
    code: zoneById.get(booking.pickupServiceZoneId).code,
    name: zoneById.get(booking.pickupServiceZoneId).name,
    latitude: Number(booking.pickupLatitude),
    longitude: Number(booking.pickupLongitude),
  };
  const destination = {
    serviceZoneId: booking.destinationServiceZoneId,
    code: zoneById.get(booking.destinationServiceZoneId).code,
    name: zoneById.get(booking.destinationServiceZoneId).name,
    latitude: Number(booking.destinationLatitude),
    longitude: Number(booking.destinationLongitude),
  };

  if (routeModeOverride === "HUB_ASSISTED") {
    return resolvePinnedHubAssistedRoute({ tx, booking, routeSnapshot, zones, origin, destination, now });
  }

  if (sameState || routeModeOverride === "LOCAL_DIRECT") {
    return {
      routeMode: "LOCAL_DIRECT", originHub: null, destinationHub: null,
      legs: [], zones, origin, destination,
    };
  }

  // An END_TO_END quote pins the execution topology. A newly activated hub must
  // not silently turn a priced one-leg shipment into three differently priced legs.
  if (routeModeOverride !== "END_TO_END") {
    const packages = packageFacts(booking);
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
      hubs, booking.pickupServiceZoneId, packages,
      Number(booking.pickupLatitude), Number(booking.pickupLongitude),
    );
    const destinationHub = nearestHub(
      hubs, booking.destinationServiceZoneId, packages,
      Number(booking.destinationLatitude), Number(booking.destinationLongitude),
    );

    if (originHub && destinationHub) {
      return {
        routeMode: "HUB_ASSISTED",
        originHub: { id: originHub.id, name: originHub.name },
        destinationHub: { id: destinationHub.id, name: destinationHub.name },
        zones, origin, destination,
        legs: [
          {
            sequence: 1, type: "LOCAL_PICKUP", status: "READY_FOR_ASSIGNMENT",
            originServiceZoneId: booking.pickupServiceZoneId,
            destinationServiceZoneId: booking.pickupServiceZoneId,
            originHubPointId: null, destinationHubPointId: originHub.id,
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
            originHubPointId: destinationHub.id, destinationHubPointId: null,
            originLatitude: destinationHub.latitude, originLongitude: destinationHub.longitude,
            destinationLatitude: booking.destinationLatitude, destinationLongitude: booking.destinationLongitude,
          },
        ],
      };
    }
  }

  return {
    routeMode: "END_TO_END", originHub: null, destinationHub: null, zones, origin, destination,
    legs: [{
      sequence: 1, type: "INTERSTATE_TRANSPORT", status: "READY_FOR_ASSIGNMENT",
      originServiceZoneId: booking.pickupServiceZoneId,
      destinationServiceZoneId: booking.destinationServiceZoneId,
      originHubPointId: null, destinationHubPointId: null,
      originLatitude: booking.pickupLatitude, originLongitude: booking.pickupLongitude,
      destinationLatitude: booking.destinationLatitude, destinationLongitude: booking.destinationLongitude,
    }],
  };
}
