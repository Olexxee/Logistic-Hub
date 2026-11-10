export function rateFitsPackage(rate, pkg) {
  if (pkg.weightGrams == null || pkg.weightGrams < rate.minWeightGrams) return false;
  if (rate.maxWeightGrams != null && pkg.weightGrams > rate.maxWeightGrams) return false;
  for (const [dimension, limit] of [["lengthMm", rate.maxLengthMm], ["widthMm", rate.maxWidthMm], ["heightMm", rate.maxHeightMm]]) {
    if (limit != null && (pkg[dimension] == null || pkg[dimension] > limit)) return false;
  }
  return true;
}

/**
 * Shared platform-operated directed-corridor tariff assessment.
 * Both ordinary customer bookings and integration clients must call this
 * function with server-resolved zones and package facts.
 */
export async function assessPlatformRouteTariffs({
  tx, originServiceZoneId, destinationServiceZoneId, packages, currency, now, routeSnapshot, expiresAt,
}) {
  if (!tx) throw new Error("A transaction client is required.");
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new TypeError("At least one package is required for tariff assessment.");
  }
  if (packages.some(pkg => !Number.isInteger(pkg.weightGrams) || pkg.weightGrams <= 0)) {
    return {
      status: "REQUIRES_MEASUREMENT",
      options: [],
      assessment: {
        status: "REQUIRES_MEASUREMENT",
        reason: "Weight is required for a defensible platform tariff match. No estimated weight is generated.",
        packageCount: packages.length,
        routeSnapshot,
        assessedAt: now.toISOString(),
      },
    };
  }

  const availability = await tx.platformRouteAvailability.findFirst({
    where: {
      originServiceZoneId,
      destinationServiceZoneId,
      serviceType: "PARCEL_DELIVERY",
      isEnabled: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
  });
  if (!availability) {
    return {
      status: "REQUIRES_OPERATIONAL_PRICING",
      options: [],
      assessment: {
        status: "REQUIRES_OPERATIONAL_PRICING",
        packageCount: packages.length,
        routeMode: "LOCAL_DIRECT",
        reason: "This directed corridor has not been approved for parcel delivery.",
        routeSnapshot,
        assessedAt: now.toISOString(),
      },
    };
  }

  const rates = await tx.platformRouteRate.findMany({
    where: {
      originServiceZoneId,
      destinationServiceZoneId,
      serviceType: "PARCEL_DELIVERY",
      parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory))] },
      currency,
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
    },
    orderBy: [{ parcelCategory: "asc" }, { version: "desc" }, { id: "asc" }],
  });

  const packageMatches = [];
  for (let index = 0; index < packages.length; index += 1) {
    const pkg = packages[index];
    const matches = rates.filter(rate => rate.parcelCategory === pkg.packageCategory && rateFitsPackage(rate, pkg));
    if (matches.length !== 1) {
      const status = matches.length > 1 ? "PRICING_AMBIGUOUS" : "NO_COVERAGE";
      return {
        status,
        options: [],
        assessment: {
          status,
          packageCount: packages.length,
          routeMode: "LOCAL_DIRECT",
          reason: matches.length > 1
            ? "More than one active platform tariff matches a package. An administrator must resolve overlapping tariff bands."
            : "No active platform tariff matches every package on this directed corridor.",
          routeSnapshot,
          assessedAt: now.toISOString(),
        },
      };
    }
    packageMatches.push({ pkg, rate: matches[0], index });
  }

  const logisticsCost = packageMatches.reduce((sum, item) => sum + item.rate.customerTransportChargeMinor, 0n);
  const platformCharge = packageMatches.reduce((sum, item) => sum + item.rate.platformChargeMinor, 0n);
  const driverPayout = packageMatches.reduce((sum, item) => sum + item.rate.driverPayoutMinor, 0n);
  const transit = packageMatches.map(item => item.rate.estimatedTransitMinutes).filter(Number.isInteger);

  return {
    status: "QUOTED",
    assessment: {
      status: "DECLARED",
      packageCount: packages.length,
      source: "PLATFORM_ROUTE_RATE",
      operationalPlanStatus: "FULLY_PRICED",
      routeSnapshot,
      assessedAt: now.toISOString(),
    },
    options: [{
      agreementId: null,
      rateCardId: null,
      currency,
      logisticsCost,
      platformCharge,
      customerCharge: logisticsCost + platformCharge,
      driverPayout,
      estimatedTransitMinutes: transit.length ? Math.max(...transit) : null,
      rateSnapshot: packageMatches.map(({ pkg, rate, index }) => ({
        packageRef: pkg.externalPackageRef ?? `package-${index + 1}`,
        externalPackageRef: pkg.externalPackageRef ?? null,
        rateId: rate.id,
        rateVersion: rate.version,
        customerTransportChargeMinor: rate.customerTransportChargeMinor.toString(),
        platformChargeMinor: rate.platformChargeMinor.toString(),
        driverPayoutMinor: rate.driverPayoutMinor.toString(),
        minWeightGrams: rate.minWeightGrams,
        maxWeightGrams: rate.maxWeightGrams,
        maxLengthMm: rate.maxLengthMm,
        maxWidthMm: rate.maxWidthMm,
        maxHeightMm: rate.maxHeightMm,
        estimatedTransitMinutes: rate.estimatedTransitMinutes,
      })),
      optionCode: "OPTION-01",
      routeSnapshot,
      expiresAt,
    }],
  };
}
