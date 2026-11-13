const VALID_EXPIRY = (now) => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

export function parcelCapabilityForLegType(legType) {
  if (legType === "DIRECT") return "LOCAL_DISPATCH";
  if (legType === "LOCAL_PICKUP") return "PICKUP_COLLECTION";
  if (legType === "FINAL_MILE") return "FINAL_MILE_DELIVERY";
  return null;
}

export function activeDriverCapabilityWhere(capability) {
  return {
    capabilities: { some: { capability, status: "APPROVED" } },
  };
}

export function eligibleVehicleWhere({ capability, now, strictMode = false, driverProfileId }) {
  return {
    ...(driverProfileId ? { driverProfileId } : {}),
    isActive: true,
    verificationStatus: "VERIFIED",
    serviceCapabilities: { some: { capability, status: "APPROVED" } },
    ...(strictMode ? {
      OR: [
        { type: "BICYCLE" },
        {
          AND: [
            {
              verificationDocuments: {
                some: {
                  documentType: "VEHICLE_REGISTRATION",
                  reviewStatus: "APPROVED",
                  ...VALID_EXPIRY(now),
                },
              },
            },
            {
              driverProfile: {
                is: {
                  verificationDocuments: {
                    some: {
                      vehicleId: null,
                      documentType: "DRIVER_LICENSE",
                      reviewStatus: "APPROVED",
                      ...VALID_EXPIRY(now),
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    } : {}),
  };
}

export function activeDriverDocumentWhere(now, strictMode = false) {
  if (!strictMode) return {};
  return {
    verificationDocuments: {
      some: {
        vehicleId: null,
        documentType: "IDENTITY",
        reviewStatus: "APPROVED",
        ...VALID_EXPIRY(now),
      },
    },
  };
}

export function eligibleParcelAssignmentDriverWhere({ driverProfileId, capability, now, strictMode = false, kycTiers = ["FULL"], requiredServiceZoneIds = [] }) {
  return {
    id: driverProfileId,
    verificationStatus: "VERIFIED",
    kycTier: { in: kycTiers },
    suspendedAt: null,
    user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
    ...activeDriverCapabilityWhere(capability),
    ...activeDriverDocumentWhere(now, strictMode),
    ...(requiredServiceZoneIds.length ? {
      AND: requiredServiceZoneIds.map(serviceZoneId => ({
        coverage: {
          some: {
            serviceZoneId,
            serviceType: "PARCEL_DELIVERY",
            isEnabled: true,
            serviceZone: { is: activeServiceZoneWhere(now) },
          },
        },
      })),
    } : {}),
  };
}

export function activeServiceZoneWhere(now) {
  return {
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
  };
}

export function eligibleParcelDriverWhere({ capability, now, strictMode = false, kycTiers }) {
  return {
    verificationStatus: "VERIFIED",
    kycTier: { in: kycTiers },
    suspendedAt: null,
    isOnline: true,
    isAvailable: true,
    user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
    ...activeDriverCapabilityWhere(capability),
    ...activeDriverDocumentWhere(now, strictMode),
    vehicles: {
      some: eligibleVehicleWhere({ capability, now, strictMode }),
    },
  };
}


export function distanceBetweenCoordinatesMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isDriverWithinPickupRadius(driver, pickup, now = new Date(), maxLocationAgeMs = 5 * 60_000) {
  const latestLocation = driver?.locations?.[0];
  if (!latestLocation || !driver.lastLocationAt || !Number.isFinite(driver.serviceRadiusMeters)
    || driver.serviceRadiusMeters <= 0) return false;
  const nowMs = now.getTime();
  const cutoff = nowMs - maxLocationAgeMs;
  const profileLocationAt = new Date(driver.lastLocationAt).getTime();
  const recordedAt = new Date(latestLocation.recordedAt).getTime();
  if (!Number.isFinite(profileLocationAt) || !Number.isFinite(recordedAt)
    || profileLocationAt < cutoff || profileLocationAt > nowMs
    || recordedAt < cutoff || recordedAt > nowMs) return false;
  const distance = distanceBetweenCoordinatesMeters(
    Number(latestLocation.latitude), Number(latestLocation.longitude),
    Number(pickup.latitude), Number(pickup.longitude),
  );
  return Number.isFinite(distance) && distance <= driver.serviceRadiusMeters;
}
