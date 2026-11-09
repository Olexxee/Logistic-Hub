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
