function inputError(message) {
  const error = new TypeError(message);
  error.code = "INVALID_DRIVER_PAYOUT_ASSESSMENT";
  return error;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function serviceZoneForLeg(leg) {
  if (leg.type === "LOCAL_PICKUP") return leg.originServiceZoneId;
  if (leg.type === "FINAL_MILE") return leg.destinationServiceZoneId;
  return null;
}

function activeAt(rule, now) {
  return rule?.status === "ACTIVE"
    && rule.effectiveFrom <= now
    && (rule.effectiveUntil == null || rule.effectiveUntil > now);
}

/**
 * Resolves internal driver compensation for one local execution leg.
 * This deliberately does not inspect or accept customer tariff amounts.
 *
 * LOCAL_PICKUP is scoped to its origin service zone; FINAL_MILE is scoped
 * to its destination service zone. Hub-transfer and interstate legs are
 * partner-execution legs and are not eligible for this rule family.
 */
export async function assessPlatformDriverPayout({ tx, leg, packages, currency, now }) {
  if (!tx?.platformDriverPayoutRule || !leg || !Array.isArray(packages)
    || packages.length === 0 || typeof currency !== "string"
    || !/^[A-Z]{3}$/.test(currency) || !(now instanceof Date)
    || Number.isNaN(now.getTime())) {
    throw inputError("A transaction, delivery leg, non-empty package list, ISO currency and valid assessment time are required.");
  }

  const serviceZoneId = serviceZoneForLeg(leg);
  if (!serviceZoneId) {
    return {
      status: "NOT_APPLICABLE",
      reason: "This delivery-leg type is not eligible for platform local-driver payout rules.",
      deliveryLegId: leg.id,
      legType: leg.type,
      totalDriverPayoutMinor: null,
      currency,
      packages: [],
    };
  }

  if (packages.some(pkg => !pkg || typeof pkg.packageCategory !== "string"
    || !pkg.packageCategory.trim() || !positiveInteger(pkg.weightGrams))) {
    return {
      status: "REQUIRES_MEASUREMENT",
      reason: "Every package requires a category and a positive measured weight in whole grams before driver compensation can be resolved.",
      deliveryLegId: leg.id,
      legType: leg.type,
      serviceZoneId,
      totalDriverPayoutMinor: null,
      currency,
      packages: [],
    };
  }

  const rules = await tx.platformDriverPayoutRule.findMany({
    where: {
      serviceZoneId,
      legType: leg.type,
      parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory.trim()))] },
      currency,
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
    },
    orderBy: [{ parcelCategory: "asc" }, { version: "desc" }, { id: "asc" }],
  });

  let total = 0n;
  const assessments = [];
  for (let index = 0; index < packages.length; index += 1) {
    const pkg = packages[index];
    const category = pkg.packageCategory.trim();
    const matches = rules.filter(rule =>
      rule.parcelCategory === category
      && Number.isSafeInteger(rule.minWeightGrams)
      && rule.minWeightGrams >= 0
      && (rule.maxWeightGrams == null
        || (Number.isSafeInteger(rule.maxWeightGrams) && rule.maxWeightGrams > rule.minWeightGrams))
      && pkg.weightGrams >= rule.minWeightGrams
      && (rule.maxWeightGrams == null || pkg.weightGrams <= rule.maxWeightGrams)
      && typeof rule.driverPayoutMinor === "bigint"
      && rule.driverPayoutMinor > 0n
      && activeAt(rule, now));

    if (matches.length !== 1) {
      const ambiguous = matches.length > 1;
      return {
        status: ambiguous ? "AMBIGUOUS_RULE" : "NO_PAYOUT_RULE",
        reason: ambiguous
          ? `More than one active driver payout rule matches package ${pkg.id ?? index + 1}.`
          : `No active driver payout rule matches package ${pkg.id ?? index + 1}.`,
        deliveryLegId: leg.id,
        legType: leg.type,
        serviceZoneId,
        totalDriverPayoutMinor: null,
        currency,
        packages: [],
      };
    }

    const rule = matches[0];
    total += rule.driverPayoutMinor;
    assessments.push({
      packageId: pkg.id ?? null,
      packageSequence: pkg.packageSequence ?? index + 1,
      packageCategory: category,
      weightGrams: pkg.weightGrams,
      rule: {
        id: rule.id,
        version: rule.version,
        serviceZoneId: rule.serviceZoneId,
        legType: rule.legType,
        parcelCategory: rule.parcelCategory,
        minWeightGrams: rule.minWeightGrams,
        maxWeightGrams: rule.maxWeightGrams ?? null,
        currency: rule.currency,
        driverPayoutMinor: rule.driverPayoutMinor.toString(),
        effectiveFrom: rule.effectiveFrom.toISOString(),
        effectiveUntil: rule.effectiveUntil?.toISOString() ?? null,
      },
    });
  }

  return {
    status: "RESOLVED",
    reason: null,
    deliveryLegId: leg.id,
    legType: leg.type,
    serviceZoneId,
    totalDriverPayoutMinor: total.toString(),
    currency,
    packages: assessments,
    assessedAt: now.toISOString(),
  };
}
