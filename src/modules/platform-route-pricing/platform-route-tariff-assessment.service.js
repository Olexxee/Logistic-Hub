import { isCanonicalPlatformRouteWeightBand } from "./platform-route-weight-bands.js";

const isPositiveInteger = value => Number.isInteger(value) && value > 0;

export function rateFitsPackage(rate, pkg) {
  if (!isPositiveInteger(pkg.weightGrams) || pkg.weightGrams < rate.minWeightGrams) return false;
  if (rate.maxWeightGrams != null && pkg.weightGrams > rate.maxWeightGrams) return false;
  for (const [dimension, limit] of [["lengthMm", rate.maxLengthMm], ["widthMm", rate.maxWidthMm], ["heightMm", rate.maxHeightMm]]) {
    if (limit != null && (!isPositiveInteger(pkg[dimension]) || pkg[dimension] > limit)) return false;
  }
  return true;
}

function validateAssessmentInput({ tx, originServiceZoneId, destinationServiceZoneId, packages, currency, now }) {
  if (!tx?.platformRouteAvailability?.findFirst || !tx?.platformRouteRate?.findMany) {
    throw new TypeError("A transaction client with route availability and tariff queries is required.");
  }
  if (typeof originServiceZoneId !== "string" || !originServiceZoneId.trim()
    || typeof destinationServiceZoneId !== "string" || !destinationServiceZoneId.trim()
    || originServiceZoneId === destinationServiceZoneId) {
    throw new TypeError("Two distinct, server-resolved service-zone identifiers are required.");
  }
  if (!Array.isArray(packages) || packages.length === 0 || packages.some(pkg => !pkg || typeof pkg !== "object" || Array.isArray(pkg))) {
    throw new TypeError("At least one valid package is required for tariff assessment.");
  }
  if (packages.some(pkg => typeof pkg.packageCategory !== "string" || !pkg.packageCategory.trim())) {
    throw new TypeError("Every package must have a resolved package category.");
  }
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError("Currency must be a three-letter uppercase code.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid assessment timestamp is required.");
  }
}

/**
 * Shared platform-operated directed-corridor tariff assessment.
 * Booking and integration flows must call this function with server-resolved
 * zones, normalized package categories and measured/declared package facts.
 */
export async function assessPlatformRouteTariffs({
  tx, originServiceZoneId, destinationServiceZoneId, packages, currency, now, routeSnapshot, expiresAt,
}) {
  validateAssessmentInput({ tx, originServiceZoneId, destinationServiceZoneId, packages, currency, now });

  if (packages.some(pkg => !isPositiveInteger(pkg.weightGrams))) {
    return {
      status: "REQUIRES_MEASUREMENT",
      options: [],
      assessment: {
        status: "REQUIRES_MEASUREMENT",
        reason: "A positive package weight in whole grams is required for a defensible platform tariff match. No estimated weight is generated.",
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
      parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory.trim()))] },
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
    const matches = rates.filter(rate =>
      rate.parcelCategory === pkg.packageCategory.trim()
      && isCanonicalPlatformRouteWeightBand(rate.minWeightGrams, rate.maxWeightGrams)
      && rateFitsPackage(rate, pkg)
    );
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
        packageCategory: pkg.packageCategory.trim(),
        weightGrams: pkg.weightGrams,
        lengthMm: pkg.lengthMm ?? null,
        widthMm: pkg.widthMm ?? null,
        heightMm: pkg.heightMm ?? null,
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
