import { isCanonicalPlatformRouteWeightBand } from "../platform-route-pricing/platform-route-weight-bands.js";

const positiveInteger = value => Number.isInteger(value) && value > 0;
const activeAt = (record, at) => Boolean(record?.isEnabled
  && (!record.startsAt || record.startsAt <= at)
  && (!record.endsAt || record.endsAt > at));

function inputError(message) {
  const error = new TypeError(message);
  error.code = "INVALID_OPERATIONAL_TARIFF_ASSESSMENT_INPUT";
  return error;
}

function validateInput({ tx, route, packages, currency, now }) {
  if (!tx?.platformOperationalTariff?.findMany
    || !tx?.platformOperationalTariffAvailability?.findFirst) {
    throw inputError("A transaction client with operational tariff and availability queries is required.");
  }
  if (!route || route.routeMode !== "HUB_ASSISTED" || !Array.isArray(route.legs) || route.legs.length === 0) {
    throw inputError("A resolved HUB_ASSISTED route with operational legs is required.");
  }
  if (!Array.isArray(packages) || packages.length === 0) throw inputError("At least one package is required.");
  if (packages.some(pkg => !pkg || typeof pkg.packageCategory !== "string" || !pkg.packageCategory.trim())) {
    throw inputError("Every package must have a resolved package category.");
  }
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw inputError("Currency must be a three-letter uppercase code.");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw inputError("A valid assessment timestamp is required.");
  const orderedLegs = [...route.legs].sort((a, b) => a.sequence - b.sequence);
  if (orderedLegs.some((leg, index) => leg.sequence !== index + 1)) {
    throw inputError("Hub-assisted route leg sequences must be contiguous and start at one.");
  }
  if (orderedLegs.length < 3 || orderedLegs[0]?.type !== "LOCAL_PICKUP" || orderedLegs.at(-1)?.type !== "FINAL_MILE"
    || orderedLegs.filter(leg => leg.type === "LOCAL_PICKUP").length !== 1
    || orderedLegs.filter(leg => leg.type === "FINAL_MILE").length !== 1
    || orderedLegs.slice(1, -1).some(leg => leg.type !== "INTERSTATE_TRANSPORT")) {
    throw inputError("A hub-assisted route requires one pickup leg, one or more interstate legs, and one final-mile leg in that order.");
  }
  for (const leg of orderedLegs) {
    if (leg.type === "LOCAL_PICKUP" || leg.type === "FINAL_MILE") {
      const zoneId = leg.type === "LOCAL_PICKUP" ? leg.originServiceZoneId : leg.destinationServiceZoneId;
      if (!zoneId) throw inputError(`${leg.type} requires its resolved service-zone identifier.`);
    } else if (leg.type === "INTERSTATE_TRANSPORT") {
      if (!leg.originHubPointId || !leg.destinationHubPointId || leg.originHubPointId === leg.destinationHubPointId) {
        throw inputError("INTERSTATE_TRANSPORT requires distinct resolved origin and destination hubs.");
      }
    }
  }
  const interstateLegs = orderedLegs.slice(1, -1);
  if (orderedLegs[0].destinationHubPointId !== interstateLegs[0].originHubPointId
    || interstateLegs.at(-1).destinationHubPointId !== orderedLegs.at(-1).originHubPointId
    || interstateLegs.some((leg, index) => index > 0 && interstateLegs[index - 1].destinationHubPointId !== leg.originHubPointId)) {
    throw inputError("Hub-assisted route legs must connect through the same resolved hub sequence.");
  }
}

function locatorFor(leg) {
  if (leg.type === "LOCAL_PICKUP" || leg.type === "FINAL_MILE") {
    return {
      scope: "LOCAL_ZONE",
      legType: leg.type,
      serviceZoneId: leg.type === "LOCAL_PICKUP" ? leg.originServiceZoneId : leg.destinationServiceZoneId,
      originHubPointId: null,
      destinationHubPointId: null,
      hubPointId: null,
      operationType: null,
    };
  }
  return {
    scope: "HUB_PAIR",
    legType: "INTERSTATE_TRANSPORT",
    serviceZoneId: null,
    originHubPointId: leg.originHubPointId,
    destinationHubPointId: leg.destinationHubPointId,
    hubPointId: null,
    operationType: null,
  };
}

function fitsDimensions(tariff, pkg) {
  return [["lengthMm", tariff.maxLengthMm], ["widthMm", tariff.maxWidthMm], ["heightMm", tariff.maxHeightMm]]
    .every(([field, limit]) => limit == null || (positiveInteger(pkg[field]) && pkg[field] <= limit));
}

function snapshotTariff(tariff) {
  return {
    id: tariff.id,
    version: tariff.version,
    scope: tariff.scope,
    legType: tariff.legType,
    operationType: tariff.operationType ?? null,
    serviceZoneId: tariff.serviceZoneId ?? null,
    originHubPointId: tariff.originHubPointId ?? null,
    destinationHubPointId: tariff.destinationHubPointId ?? null,
    hubPointId: tariff.hubPointId ?? null,
    parcelCategory: tariff.parcelCategory,
    minWeightGrams: tariff.minWeightGrams,
    maxWeightGrams: tariff.maxWeightGrams,
    maxLengthMm: tariff.maxLengthMm ?? null,
    maxWidthMm: tariff.maxWidthMm ?? null,
    maxHeightMm: tariff.maxHeightMm ?? null,
    currency: tariff.currency,
    customerChargeMinor: tariff.customerChargeMinor.toString(),
    platformChargeMinor: tariff.platformChargeMinor.toString(),
    effectiveFrom: tariff.effectiveFrom.toISOString(),
    effectiveUntil: tariff.effectiveUntil?.toISOString() ?? null,
  };
}

function result(status, reason, route, now, extra = {}) {
  return {
    status,
    reason,
    routeMode: route.routeMode,
    routeSnapshot: {
      routeMode: route.routeMode,
      routePlanVersion: 1,
      origin: route.origin ?? null,
      destination: route.destination ?? null,
      originHub: route.originHub ?? null,
      destinationHub: route.destinationHub ?? null,
      legs: [...route.legs].sort((a, b) => a.sequence - b.sequence).map(leg => ({
        sequence: leg.sequence,
        type: leg.type,
        originServiceZoneId: leg.originServiceZoneId ?? null,
        destinationServiceZoneId: leg.destinationServiceZoneId ?? null,
        originHubPointId: leg.originHubPointId ?? null,
        destinationHubPointId: leg.destinationHubPointId ?? null,
        origin: {
          latitude: leg.originLatitude == null ? null : Number(leg.originLatitude),
          longitude: leg.originLongitude == null ? null : Number(leg.originLongitude),
        },
        destination: {
          latitude: leg.destinationLatitude == null ? null : Number(leg.destinationLatitude),
          longitude: leg.destinationLongitude == null ? null : Number(leg.destinationLongitude),
        },
      })),
    },
    assessedAt: now.toISOString(),
    currency: extra.currency ?? null,
    packageCount: extra.packageCount ?? 0,
    legs: extra.legs ?? [],
    handling: extra.handling ?? { status: "NOT_ASSESSED", items: [] },
    totals: extra.totals ?? null,
    executionReadiness: {
      status: "NOT_ASSESSED",
      reason: "Execution eligibility and internal costs must be resolved independently from customer tariffs.",
    },
  };
}

/**
 * Assesses customer-facing tariffs against an already resolved HUB_ASSISTED route.
 * It is intentionally read-only: callers own quote persistence and lifecycle.
 */
export async function assessPlatformOperationalTariffs({
  tx, route, packages, currency, now, handlingOperations = [],
}) {
  validateInput({ tx, route, packages, currency, now });
  if (packages.some(pkg => !positiveInteger(pkg.weightGrams))) {
    return result("REQUIRES_MEASUREMENT",
      "Every package requires a positive weight in whole grams before an operational tariff can be matched.",
      route, now, { currency, packageCount: packages.length });
  }

  if (packages.some(pkg => pkg.weightGrams > 30000)) {
    return result("REQUIRES_MANUAL_ASSESSMENT",
      "Packages above the canonical 30 kg tariff ceiling require manual freight assessment.",
      route, now, { currency, packageCount: packages.length });
  }

  if (!Array.isArray(handlingOperations)) throw inputError("handlingOperations must be an array.");
  const chargeableOperations = handlingOperations.filter(operation => operation?.status !== "CANCELLED");
  if (chargeableOperations.some(operation => operation?.status !== "COMPLETED"
    || !operation.authorizedByUserId || !operation.authorizedAt
    || !operation.customerAuthorizedByUserId || !operation.customerAuthorizedAt
    || !operation.completedByUserId || !operation.completedAt)) {
    return result("REQUIRES_OPERATIONAL_REVIEW",
      "Additional handling is billable only after operational authorization, customer authorization and completion by identified actors.",
      route, now, { currency, packageCount: packages.length, handling: { status: "NOT_COMPLETED_AND_AUTHORIZED", items: [] } });
  }
  if (chargeableOperations.length) {
    return result("REQUIRES_OPERATIONAL_REVIEW",
      "HubAdditionalOperation is attached to a delivery leg, not to the package(s) processed. Package attribution is required before a weight-banded handling tariff can be charged.",
      route, now, {
        currency, packageCount: packages.length,
        handling: { status: "PACKAGE_ATTRIBUTION_REQUIRED", items: [] },
      });
  }

  const orderedLegs = [...route.legs].sort((a, b) => a.sequence - b.sequence);
  const assessedLegs = [];
  let customerChargeMinor = 0n;
  let platformChargeMinor = 0n;

  for (const leg of orderedLegs) {
    const locator = locatorFor(leg);
    const exactLocator = {
      scope: locator.scope,
      serviceType: "PARCEL_DELIVERY",
      legType: locator.legType,
      operationType: null,
      serviceZoneId: locator.serviceZoneId,
      originHubPointId: locator.originHubPointId,
      destinationHubPointId: locator.destinationHubPointId,
      hubPointId: null,
    };
    const availability = await tx.platformOperationalTariffAvailability.findFirst({
      where: {
        ...exactLocator,
        isEnabled: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
    });
    if (!activeAt(availability, now)) {
      return result("NO_COVERAGE", `No enabled, effective availability exists for route leg ${leg.sequence} (${leg.type}). No other pricing scope is substituted.`,
        route, now, { currency, packageCount: packages.length });
    }

    const tariffs = await tx.platformOperationalTariff.findMany({
      where: {
        ...exactLocator,
        parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory.trim()))] },
        currency,
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      },
      orderBy: [{ parcelCategory: "asc" }, { version: "desc" }, { id: "asc" }],
    });

    const packageAssessments = [];
    for (let index = 0; index < packages.length; index += 1) {
      const pkg = packages[index];
      const matches = tariffs.filter(tariff =>
        tariff.parcelCategory === pkg.packageCategory.trim()
        && isCanonicalPlatformRouteWeightBand(tariff.minWeightGrams, tariff.maxWeightGrams)
        && pkg.weightGrams >= tariff.minWeightGrams
        && (tariff.maxWeightGrams == null || pkg.weightGrams <= tariff.maxWeightGrams)
        && fitsDimensions(tariff, pkg));
      if (matches.length !== 1) {
        const ambiguous = matches.length > 1;
        return result(ambiguous ? "PRICING_AMBIGUOUS" : "NO_COVERAGE",
          ambiguous
            ? `More than one active operational tariff matches package ${pkg.id ?? index + 1} on route leg ${leg.sequence}.`
            : `No active operational tariff matches package ${pkg.id ?? index + 1} on route leg ${leg.sequence} (${leg.type}).`,
          route, now, { currency, packageCount: packages.length });
      }
      const tariff = matches[0];
      const charge = tariff.customerChargeMinor;
      const platform = tariff.platformChargeMinor;
      customerChargeMinor += charge;
      platformChargeMinor += platform;
      packageAssessments.push({
        packageId: pkg.id ?? null,
        packageSequence: index + 1,
        packageCategory: pkg.packageCategory.trim(),
        weightGrams: pkg.weightGrams,
        dimensionsMm: {
          length: pkg.lengthMm ?? null, width: pkg.widthMm ?? null, height: pkg.heightMm ?? null,
        },
        tariff: snapshotTariff(tariff),
      });
    }
    assessedLegs.push({
      sequence: leg.sequence,
      type: leg.type,
      originServiceZoneId: leg.originServiceZoneId ?? null,
      destinationServiceZoneId: leg.destinationServiceZoneId ?? null,
      originHubPointId: leg.originHubPointId ?? null,
      destinationHubPointId: leg.destinationHubPointId ?? null,
      packages: packageAssessments,
    });
  }

  return result("QUOTED", null, route, now, {
    currency,
    packageCount: packages.length,
    legs: assessedLegs,
    totals: {
      customerChargeMinor: customerChargeMinor.toString(),
      platformChargeMinor: platformChargeMinor.toString(),
      totalCustomerChargeMinor: (customerChargeMinor + platformChargeMinor).toString(),
    },
    handling: { status: "NO_CHARGEABLE_OPERATIONS", items: [] },
  });
}
