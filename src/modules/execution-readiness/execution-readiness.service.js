import { env } from "../../config/env.js";
import { assessPlatformDriverPayout } from "../platform-operational-pricing/platform-driver-payout-assessment.service.js";
import { rateFitsPackage } from "../platform-route-pricing/platform-route-tariff-assessment.service.js";
import { isDriverWithinPickupRadius } from "../drivers/driver-dispatch-eligibility.js";
import { createExecutionReadinessRepository } from "./execution-readiness.repository.js";

const LOCAL_DRIVER_LEG_TYPES = new Set(["LOCAL_PICKUP", "FINAL_MILE"]);
const PARTNER_LEG_TYPES = new Set(["HUB_TRANSFER", "INTERSTATE_TRANSPORT"]);
async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

function blocker(code, message, scope = null) {
  return { code, message, ...(scope ? { scope } : {}) };
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function packageVolumeCm3(pkg) {
  if (![pkg.lengthMm, pkg.widthMm, pkg.heightMm].every(validPositiveInteger)) return null;
  const volume = pkg.lengthMm * pkg.widthMm * pkg.heightMm / 1000;
  return Number.isSafeInteger(Math.ceil(volume)) ? Math.ceil(volume) : null;
}

function isHubAssistedAcceptedQuote(quote) {
  return quote?.inputSnapshot?.source === "PLATFORM_OPERATIONAL_TARIFF"
    || (quote?.inputSnapshot?.source === "INTEGRATION_QUOTE"
      && quote?.inputSnapshot?.routeSnapshot?.routeMode === "HUB_ASSISTED");
}

function packageFactsMatchAcceptedQuote(leg, quote, packages) {
  const snapshotLegs = quote?.inputSnapshot?.operationalTariffAssessment?.legs
    ?? quote?.inputSnapshot?.packageRateSnapshot;
  if (!Array.isArray(snapshotLegs)) return false;
  const snapshotLeg = snapshotLegs.find(item => item.sequence === leg.sequence && item.type === leg.type);
  if (!Array.isArray(snapshotLeg?.packages) || snapshotLeg.packages.length !== packages.length) return false;
  return packages.every((pkg, index) => {
    const snapshot = snapshotLeg.packages.find(item => item.packageSequence === (pkg.packageSequence ?? index + 1));
    if (!snapshot) return false;
    const dimensions = snapshot.dimensionsMm ?? {};
    return (snapshot.packageId == null || snapshot.packageId === pkg.id)
      && snapshot.packageCategory === pkg.packageCategory
      && snapshot.weightGrams === pkg.weightGrams
      && (dimensions.length ?? null) === (pkg.lengthMm ?? null)
      && (dimensions.width ?? null) === (pkg.widthMm ?? null)
      && (dimensions.height ?? null) === (pkg.heightMm ?? null);
  });
}

function routeLegMatchesSnapshot(leg, quote) {
  const routeLegs = quote?.inputSnapshot?.routeSnapshot?.legs;
  if (!Array.isArray(routeLegs)) return false;
  const snapshot = routeLegs.find(item => item.sequence === leg.sequence);
  return Boolean(snapshot
    && snapshot.type === leg.type
    && snapshot.originServiceZoneId === leg.originServiceZoneId
    && snapshot.destinationServiceZoneId === leg.destinationServiceZoneId
    && (snapshot.originHubPointId ?? null) === (leg.originHubPointId ?? null)
    && (snapshot.destinationHubPointId ?? null) === (leg.destinationHubPointId ?? null)
    && Number(snapshot.origin?.latitude) === Number(leg.originLatitude)
    && Number(snapshot.origin?.longitude) === Number(leg.originLongitude)
    && Number(snapshot.destination?.latitude) === Number(leg.destinationLatitude)
    && Number(snapshot.destination?.longitude) === Number(leg.destinationLongitude));
}

function matchPartnerCandidates(rates, packages, currency) {
  const byCard = new Map();
  for (const rate of rates) {
    const list = byCard.get(rate.rateCardId) ?? [];
    list.push(rate);
    byCard.set(rate.rateCardId, list);
  }

  const candidates = [];
  let ambiguousRateCardCount = 0;
  let missingDimensionEvidence = false;

  for (const [rateCardId, cardRates] of byCard) {
    const matched = [];
    let valid = true;
    for (let index = 0; index < packages.length; index += 1) {
      const pkg = packages[index];
      const categoryRates = cardRates.filter(rate => rate.parcelCategory === pkg.packageCategory);
      const weightRates = categoryRates.filter(rate => validPositiveInteger(pkg.weightGrams)
        && pkg.weightGrams >= rate.minWeightGrams
        && (rate.maxWeightGrams == null || pkg.weightGrams <= rate.maxWeightGrams));
      const matches = weightRates.filter(rate => rateFitsPackage(rate, pkg)
        && typeof rate.transportChargeMinor === "bigint" && rate.transportChargeMinor > 0n);
      if (matches.length !== 1) {
        if (matches.length > 1) ambiguousRateCardCount += 1;
        if (weightRates.some(rate =>
          (rate.maxLengthMm != null && !validPositiveInteger(pkg.lengthMm))
          || (rate.maxWidthMm != null && !validPositiveInteger(pkg.widthMm))
          || (rate.maxHeightMm != null && !validPositiveInteger(pkg.heightMm)))) {
          missingDimensionEvidence = true;
        }
        valid = false;
        break;
      }
      matched.push({ package: pkg, rate: matches[0], packageSequence: pkg.packageSequence ?? index + 1 });
    }
    if (!valid || matched.length !== packages.length) continue;

    const total = matched.reduce((sum, item) => sum + item.rate.transportChargeMinor, 0n);
    const rateCard = cardRates[0].rateCard;
    const agreement = rateCard.agreement;
    candidates.push({
      partnerId: agreement.partner.id,
      partnerName: agreement.partner.displayName,
      agreementId: agreement.id,
      agreementReference: agreement.reference,
      rateCardId,
      rateCardVersion: rateCard.version,
      currency,
      totalExecutionCostMinor: total.toString(),
      packageRates: matched.map(item => ({
        packageId: item.package.id,
        packageSequence: item.packageSequence,
        packageCategory: item.package.packageCategory,
        weightGrams: item.package.weightGrams,
        rateId: item.rate.id,
        transportChargeMinor: item.rate.transportChargeMinor.toString(),
        estimatedTransitMinutes: item.rate.estimatedTransitMinutes,
      })),
    });
  }

  candidates.sort((a, b) => {
    const left = BigInt(a.totalExecutionCostMinor);
    const right = BigInt(b.totalExecutionCostMinor);
    if (left !== right) return left < right ? -1 : 1;
    return a.partnerId.localeCompare(b.partnerId) || a.rateCardId.localeCompare(b.rateCardId);
  });
  return { candidates, ambiguousRateCardCount, missingDimensionEvidence };
}

async function assessHub({ repository, tx, hubPointId, expectedServiceZoneId, packages, now, checkCapacity }) {
  if (!hubPointId) return [];
  const hub = await repository.findActiveHub(tx, hubPointId, now);
  if (!hub) return [blocker("HUB_NOT_FOUND", "A route hub referenced by this leg no longer exists.", hubPointId)];
  const blockers = [];
  if (hub.status !== "ACTIVE" || hub.operatorVerificationStatus !== "VERIFIED") {
    blockers.push(blocker("HUB_NOT_OPERATIONAL", "The route hub must be active with a verified operator.", hubPointId));
  }
  if (hub.serviceZoneId !== expectedServiceZoneId || hub.serviceZone?.id !== expectedServiceZoneId) {
    blockers.push(blocker("HUB_ZONE_MISMATCH", "The route hub is not in the service zone pinned by the accepted route.", hubPointId));
  }
  if (!hub.serviceZone?.isActive || !hub.serviceZone?.state?.isActive
    || !hub.serviceZone?.state?.country?.isActive || !hub.serviceZone?.availability?.length) {
    blockers.push(blocker("HUB_SERVICE_ZONE_UNAVAILABLE", "The route hub's parcel-delivery service zone is not currently available.", hubPointId));
  }
  const acceptedTypes = Array.isArray(hub.acceptedParcelTypes) ? hub.acceptedParcelTypes : [];
  if (!packages.every(pkg => acceptedTypes.includes(pkg.packageCategory))) {
    blockers.push(blocker("HUB_PARCEL_TYPE_UNSUPPORTED", "The route hub does not accept every package category in this shipment.", hubPointId));
  }

  if (checkCapacity) {
    const capacity = hub.capacityConfig;
    if (!capacity || !Number.isSafeInteger(capacity.maxParcels) || capacity.maxParcels < 1) {
      blockers.push(blocker("HUB_CAPACITY_UNCONFIGURED", "The receiving hub has no valid parcel-capacity configuration.", hubPointId));
    } else {
      const { load, missingVolumeCount } = await repository.getHubLoad(tx, hubPointId);
      const occupiedParcels = load._count._all;
      if (occupiedParcels + packages.length > capacity.maxParcels) {
        blockers.push(blocker("HUB_PARCEL_CAPACITY_EXCEEDED", "The receiving hub does not have enough remaining parcel capacity.", hubPointId));
      }
      if (capacity.maxWeightGrams != null) {
        if (!packages.every(pkg => validPositiveInteger(pkg.weightGrams))) {
          blockers.push(blocker("HUB_WEIGHT_MEASUREMENT_REQUIRED", "Measured package weights are required to verify the receiving hub's weight capacity.", hubPointId));
        } else if (Number(load._sum.weightGrams ?? 0) + packages.reduce((sum, pkg) => sum + pkg.weightGrams, 0) > capacity.maxWeightGrams) {
          blockers.push(blocker("HUB_WEIGHT_CAPACITY_EXCEEDED", "The receiving hub's remaining weight capacity is insufficient.", hubPointId));
        }
      }
      if (capacity.maxVolumeCm3 != null) {
        const packageVolumes = packages.map(packageVolumeCm3);
        if (missingVolumeCount > 0 || packageVolumes.some(value => value == null)) {
          blockers.push(blocker("HUB_VOLUME_MEASUREMENT_REQUIRED", "Complete package dimensions and existing intake volume records are required to verify receiving-hub volume capacity.", hubPointId));
        } else if (Number(load._sum.volumeCm3 ?? 0) + packageVolumes.reduce((sum, value) => sum + value, 0) > capacity.maxVolumeCm3) {
          blockers.push(blocker("HUB_VOLUME_CAPACITY_EXCEEDED", "The receiving hub's remaining volume capacity is insufficient.", hubPointId));
        }
      }
    }
  }
  return blockers;
}

export function createExecutionReadinessService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createExecutionReadinessRepository({ prismaClient });

  return {
    async assessLeg({ deliveryLegId, tx: transactionClient = null }) {
      const now = clock();
      const assess = async tx => {
        const leg = await db.findLeg(tx, deliveryLegId);
        if (!leg) return { found: false, deliveryLegId };
        const booking = leg.parcelBooking;
        const blockers = [];

        if (leg.metadata?.pricingSource !== "PLATFORM_OPERATIONAL_TARIFF"
          || leg.metadata?.requiresOperationalReview !== true) {
          blockers.push(blocker("NOT_HUB_ASSISTED_TARIFF_LEG", "This resolver only assesses legs created from the hub-assisted platform tariff flow."));
        }
        const acceptedQuote = booking.quotes?.find(quote => quote.id === leg.metadata?.quoteId);
        if (!acceptedQuote || acceptedQuote.status !== "ACCEPTED"
          || !isHubAssistedAcceptedQuote(acceptedQuote)
          || !routeLegMatchesSnapshot(leg, acceptedQuote)) {
          blockers.push(blocker("ACCEPTED_ROUTE_SNAPSHOT_MISMATCH", "The leg does not match its accepted hub-assisted quote and immutable route topology."));
        }
        if (booking.paymentStatus !== "SUCCEEDED") {
          blockers.push(blocker("BOOKING_NOT_PAID", "Execution readiness is assessed only after successful customer payment."));
        }
        if (booking.integrationClientId && !booking.integrationDispatchAuthorizedAt) {
          blockers.push(blocker("INTEGRATION_DISPATCH_REVIEW_PENDING", "The integration shipment has not been released for operational dispatch."));
        }
        if (leg.status !== "PLANNED" && leg.status !== "READY_FOR_ASSIGNMENT") {
          blockers.push(blocker("LEG_STATE_NOT_ASSESSABLE", "Only planned or previously readiness-assessed legs can be assessed."));
        }

        const packages = (booking.parcelPackages ?? []).map(pkg => ({
          id: pkg.id,
          packageSequence: pkg.packageSequence,
          packageCategory: pkg.packageCategory,
          weightGrams: pkg.weightGrams,
          lengthMm: pkg.lengthMm,
          widthMm: pkg.widthMm,
          heightMm: pkg.heightMm,
        }));
        if (!packages.length) {
          blockers.push(blocker("PACKAGE_FACTS_MISSING", "Package-level facts are required; legacy booking-level parcel fields are not sufficient for execution-cost assessment."));
        }
        if (packages.some(pkg => !pkg.packageCategory || !pkg.packageCategory.trim())) {
          blockers.push(blocker("PACKAGE_CATEGORY_MISSING", "Every package requires a normalized category."));
        }
        if (acceptedQuote && packages.length
          && !packageFactsMatchAcceptedQuote(leg, acceptedQuote, packages)) {
          blockers.push(blocker("PACKAGE_FACTS_CHANGED", "Current package categories, weights or dimensions do not match the package facts pinned by the accepted quote."));
        }

        const currency = acceptedQuote?.currency ?? booking.currency;
        const activeZones = await db.findActiveServiceZones(
          tx,
          [...new Set([leg.originServiceZoneId, leg.destinationServiceZoneId])],
          now,
        );
        if (activeZones.length !== new Set([leg.originServiceZoneId, leg.destinationServiceZoneId]).size) {
          blockers.push(blocker("SERVICE_ZONE_UNAVAILABLE", "Both service zones pinned by the accepted route must remain active for parcel delivery."));
        }

        const hubChecks = await Promise.all([
          assessHub({
            repository: db, tx, hubPointId: leg.originHubPointId,
            expectedServiceZoneId: leg.originServiceZoneId, packages, now, checkCapacity: false,
          }),
          assessHub({
            repository: db, tx, hubPointId: leg.destinationHubPointId,
            expectedServiceZoneId: leg.destinationServiceZoneId, packages, now,
            checkCapacity: Boolean(leg.destinationHubPointId),
          }),
        ]);
        blockers.push(...hubChecks.flat());

        let execution = null;
        if (LOCAL_DRIVER_LEG_TYPES.has(leg.type) && packages.length) {
          const payout = await assessPlatformDriverPayout({
            tx, leg, packages, currency, now,
          });
          if (payout.status !== "RESOLVED") {
            blockers.push(blocker(payout.status, payout.reason));
          }
          const drivers = await db.findEligibleLocalDrivers(tx, leg, now);
          const eligibleDrivers = drivers.filter(driver => isDriverWithinPickupRadius(
            driver,
            { latitude: leg.originLatitude, longitude: leg.originLongitude },
            now,
            env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000,
          ));
          if (!eligibleDrivers.length) {
            blockers.push(blocker("NO_ELIGIBLE_LOCAL_DRIVER", "No verified, available local driver with approved capability, eligible vehicle, active coverage and fresh pickup-radius location can execute this leg."));
          }
          execution = {
            mode: "PLATFORM_DRIVER",
            payoutAssessment: payout,
            eligibleDriverCount: eligibleDrivers.length,
          };
        } else if (PARTNER_LEG_TYPES.has(leg.type) && packages.length) {
          if (packages.some(pkg => !validPositiveInteger(pkg.weightGrams))) {
            blockers.push(blocker("REQUIRES_MEASUREMENT", "Every package requires a positive measured weight before partner execution rates can be matched."));
          } else {
            const rates = await db.findPartnerRates(tx, leg, packages, currency, now);
            const matched = matchPartnerCandidates(rates, packages, currency);
            if (!matched.candidates.length) {
              blockers.push(blocker(
                matched.missingDimensionEvidence ? "PARTNER_RATE_DIMENSIONS_REQUIRED"
                  : matched.ambiguousRateCardCount ? "AMBIGUOUS_PARTNER_RATE"
                    : "NO_PARTNER_EXECUTION_RATE",
                matched.missingDimensionEvidence
                  ? "Package dimensions are required by the available partner rate-card constraints."
                  : matched.ambiguousRateCardCount
                    ? "More than one partner rate matches at least one package within an otherwise eligible rate card."
                    : "No single active verified partner rate card covers every package on this directed leg.",
              ));
            }
            execution = {
              mode: "TRANSPORT_PARTNER",
              partnerCandidates: matched.candidates,
            };
          }
        } else if (!LOCAL_DRIVER_LEG_TYPES.has(leg.type) && !PARTNER_LEG_TYPES.has(leg.type)) {
          blockers.push(blocker("UNSUPPORTED_EXECUTION_LEG_TYPE", "This delivery-leg type has no approved HAT execution policy."));
        }

        return {
          found: true,
          deliveryLegId: leg.id,
          sequence: leg.sequence,
          legType: leg.type,
          readiness: blockers.length ? "BLOCKED" : "READY",
          dispatchAuthorized: false,
          blockers,
          execution,
          currency,
          assessedAt: now.toISOString(),
        };
      };
      return transactionClient ? assess(transactionClient) : serializableTransaction(prismaClient, assess);
    },

    async assessBooking({ bookingId }) {
      const legs = await prismaClient.deliveryLeg.findMany({
        where: { parcelBookingId: bookingId },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        select: { id: true, sequence: true },
      });
      if (!legs.length) return { found: false, bookingId, legs: [] };
      const assessments = [];
      for (const leg of legs) assessments.push(await this.assessLeg({ deliveryLegId: leg.id }));
      return {
        found: true,
        bookingId,
        readiness: assessments.every(item => item.readiness === "READY") ? "READY" : "BLOCKED",
        dispatchAuthorized: false,
        legs: assessments,
      };
    },
  };
}
