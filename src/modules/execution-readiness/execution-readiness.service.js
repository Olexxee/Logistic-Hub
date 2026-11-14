import { createHash } from "node:crypto";
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

function selectionPayloadHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function packageFactsMatchAnyAcceptedQuote(quote, packages) {
  const snapshotLegs = quote?.inputSnapshot?.operationalTariffAssessment?.legs
    ?? quote?.inputSnapshot?.packageRateSnapshot;
  if (!Array.isArray(snapshotLegs)) return false;
  return snapshotLegs.some(snapshotLeg => {
    if (!Array.isArray(snapshotLeg?.packages) || snapshotLeg.packages.length !== packages.length) return false;
    return packages.every((pkg, index) => {
      const snapshot = snapshotLeg.packages.find(item =>
        item.packageId === pkg.id
        || (item.packageId == null && item.packageSequence === (pkg.packageSequence ?? index + 1)));
      if (!snapshot) return false;
      const dimensions = snapshot.dimensionsMm ?? {};
      return snapshot.packageCategory === pkg.packageCategory
        && snapshot.weightGrams === pkg.weightGrams
        && (dimensions.length ?? null) === (pkg.lengthMm ?? null)
        && (dimensions.width ?? null) === (pkg.widthMm ?? null)
        && (dimensions.height ?? null) === (pkg.heightMm ?? null);
    });
  });
}

function validateRecoveryDisposition(disposition, leg, booking) {
  const metadata = leg.metadata ?? {};
  const blockers = [];
  if (!disposition) {
    blockers.push(blocker(
      "RECOVERY_DISPOSITION_NOT_FOUND",
      "A recovery continuation must be linked to its persisted hub-intake disposition.",
    ));
    return { valid: false, blockers, context: null };
  }

  const intake = disposition.intakeRecord;
  const recovery = disposition.hubRecovery;
  const source = disposition.sourceDeliveryLeg;
  const originHub = disposition.hubPoint;
  const destinationHub = disposition.destinationHubPoint;
  const sourceLegId = disposition.sourceDeliveryLegId;

  const valid = disposition.id
    && disposition.decision === "CONTINUE_DELIVERY"
    && disposition.status === "ROUTE_APPROVED"
    && disposition.nextDeliveryLegId === leg.id
    && disposition.parcelBookingId === booking.id
    && intake?.id === metadata.sourceIntakeRecordId
    && intake?.status === "RECEIVED"
    && intake?.parcelBookingId === booking.id
    && intake?.deliveryLegId === sourceLegId
    && intake?.hubPointId === disposition.hubPointId
    && recovery?.id === metadata.hubRecoveryId
    && recovery?.status === "CONFIRMED"
    && recovery?.parcelBookingId === booking.id
    && recovery?.deliveryLegId === sourceLegId
    && recovery?.hubPointId === disposition.hubPointId
    && recovery?.hubIntakeRecordId === intake.id
    && source?.id === sourceLegId
    && source?.parcelBookingId === booking.id
    && source?.status === "FAILED"
    && source?.failureReason === "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED"
    && leg.metadata?.source === "DRV-05C-D2_HUB_RECOVERY"
    && leg.metadata?.sourceDeliveryLegId === sourceLegId
    && leg.sequence === source.sequence + 1
    && originHub?.id === disposition.hubPointId
    && leg.originHubPointId === originHub.id
    && leg.originServiceZoneId === originHub.serviceZoneId
    && Number(leg.originLatitude) === Number(originHub.latitude)
    && Number(leg.originLongitude) === Number(originHub.longitude)
    && (disposition.destinationServiceZoneId ?? null) === leg.destinationServiceZoneId
    && (disposition.destinationHubPointId ?? null) === (leg.destinationHubPointId ?? null)
    && (destinationHub
      ? destinationHub.id === leg.destinationHubPointId
        && destinationHub.serviceZoneId === leg.destinationServiceZoneId
        && PARTNER_LEG_TYPES.has(leg.type)
        && Number(leg.destinationLatitude) === Number(destinationHub.latitude)
        && Number(leg.destinationLongitude) === Number(destinationHub.longitude)
      : leg.destinationHubPointId == null
        && leg.type === "FINAL_MILE"
        && Number(leg.destinationLatitude) === Number(booking.destinationLatitude)
        && Number(leg.destinationLongitude) === Number(booking.destinationLongitude))
    && booking.paymentStatus === "SUCCEEDED"
    && booking.status === "IN_TRANSIT";

  if (!valid) {
    blockers.push(blocker(
      "RECOVERY_DISPOSITION_MISMATCH",
      "The approved recovery disposition, received intake, confirmed recovery, failed source leg and continuation route must all match exactly.",
      disposition.id,
    ));
  }

  return {
    valid: Boolean(valid),
    blockers,
    context: valid ? {
      dispositionId: disposition.id,
      intakeRecordId: intake.id,
      hubRecoveryId: recovery.id,
      sourceDeliveryLegId: sourceLegId,
    } : null,
  };
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
        const recoveryDisposition = await db.findRecoveryDisposition?.(tx, leg.id) ?? null;
        const recoveryCandidate = leg.metadata?.source === "DRV-05C-D2_HUB_RECOVERY" || Boolean(recoveryDisposition);
        const recoveryValidation = recoveryCandidate
          ? validateRecoveryDisposition(recoveryDisposition, leg, booking)
          : { valid: false, blockers: [], context: null };
        blockers.push(...recoveryValidation.blockers);

        if (leg.sequence > 1) {
          const previousLeg = await db.findPreviousLeg(tx, leg);
          const completedNormally = previousLeg?.status === "COMPLETED" && Boolean(previousLeg.completedAt);
          const exactRecoveryPredecessor = recoveryValidation.valid
            && previousLeg?.id === recoveryValidation.context.sourceDeliveryLegId
            && previousLeg.status === "FAILED"
            && previousLeg.failureReason === "HUB_CUSTODY_RECOVERY_ROUTE_REPLANNED";
          if (!completedNormally && !exactRecoveryPredecessor) {
            blockers.push(blocker(
              "PREVIOUS_LEG_NOT_COMPLETED",
              "A delivery leg requires a completed predecessor, except for the exact failed source leg superseded by its approved hub-recovery disposition.",
              previousLeg?.id ?? null,
            ));
          }
        }

        if (!recoveryCandidate && (leg.metadata?.pricingSource !== "PLATFORM_OPERATIONAL_TARIFF"
          || leg.metadata?.requiresOperationalReview !== true)) {
          blockers.push(blocker("NOT_HUB_ASSISTED_TARIFF_LEG", "This resolver only assesses legs created from the hub-assisted platform tariff flow."));
        }
        const acceptedQuote = booking.quotes?.find(quote => quote.id === leg.metadata?.quoteId)
          ?? (recoveryCandidate ? booking.quotes?.[0] : null);
        if (!acceptedQuote || acceptedQuote.status !== "ACCEPTED"
          || !isHubAssistedAcceptedQuote(acceptedQuote)
          || (!recoveryCandidate && !routeLegMatchesSnapshot(leg, acceptedQuote))) {
          blockers.push(blocker("ACCEPTED_ROUTE_SNAPSHOT_MISMATCH", "The leg must be backed by an accepted hub-assisted booking quote; ordinary legs must also match its immutable route topology."));
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
          && (recoveryCandidate
            ? !packageFactsMatchAnyAcceptedQuote(acceptedQuote, packages)
            : !packageFactsMatchAcceptedQuote(leg, acceptedQuote, packages))) {
          blockers.push(blocker("PACKAGE_FACTS_CHANGED", "Current package categories, weights or dimensions do not match the package facts pinned by the accepted booking quote."));
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
          recovery: recoveryValidation.context,
          assessedAt: now.toISOString(),
        };
      };
      return transactionClient ? assess(transactionClient) : serializableTransaction(prismaClient, assess);
    },

    async selectExecutor({
      deliveryLegId, executorType, driverProfileId, vehicleId, partnerId,
      selectedByUserId, idempotencyKey,
    }) {
      const now = clock();
      const payload = { deliveryLegId, executorType, driverProfileId: driverProfileId ?? null,
        vehicleId: vehicleId ?? null, partnerId: partnerId ?? null };
      const payloadHash = selectionPayloadHash(payload);
      try {
        return await serializableTransaction(prismaClient, async tx => {
        const prior = await tx.deliveryLegExecutionSnapshot.findUnique({ where: { idempotencyKey } });
        if (prior) {
          if (prior.deliveryLegId !== deliveryLegId || prior.payloadHash !== payloadHash) {
            const error = new Error("The idempotency key was already used for a different executor selection.");
            error.statusCode = 409;
            error.code = "IDEMPOTENCY_KEY_REUSED";
            throw error;
          }
          return { snapshot: prior, replay: true };
        }

        const leg = await db.findLeg(tx, deliveryLegId);
        if (!leg) return { found: false, deliveryLegId };
        if (!["PLANNED", "READY_FOR_ASSIGNMENT"].includes(leg.status)) {
          return { blocked: true, blockers: [blocker("LEG_STATE_NOT_SELECTABLE", "Only planned or unassigned readiness-assessed legs can receive an execution snapshot.")] };
        }
        const [activeOffers, activeDriverAssignments, activePartnerAssignments] = await Promise.all([
          tx.deliveryLegOffer.count({ where: { deliveryLegId, status: "OFFERED", expiresAt: { gt: now } } }),
          tx.driverAssignment.count({ where: { deliveryLegId, status: { in: ["AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"] } } }),
          tx.partnerDeliveryAssignment.count({ where: { deliveryLegId, status: { in: ["ASSIGNED", "ACCEPTED", "IN_TRANSIT"] } } }),
        ]);
        if (activeOffers || activeDriverAssignments || activePartnerAssignments) {
          return { blocked: true, blockers: [blocker("EXECUTOR_ALREADY_COMMITTED", "An active offer or assignment exists; this executor snapshot cannot be replaced.")] };
        }

        const assessment = await this.assessLeg({ deliveryLegId, tx });
        if (!assessment.found || assessment.readiness !== "READY") {
          return { blocked: true, blockers: assessment.blockers ?? [blocker("READINESS_ASSESSMENT_FAILED", "The delivery leg could not be assessed.")] };
        }

        const booking = leg.parcelBooking;
        const acceptedQuote = booking.quotes?.find(quote => quote.id === leg.metadata?.quoteId);
        let selected = {};
        let executionCostMinor;
        let costSource;
        let costSourceVersion = null;
        if (executorType === "PLATFORM_DRIVER") {
          if (!LOCAL_DRIVER_LEG_TYPES.has(leg.type) || !driverProfileId || !vehicleId
            || assessment.execution?.mode !== "PLATFORM_DRIVER"
            || assessment.execution?.payoutAssessment?.status !== "RESOLVED") {
            return { blocked: true, blockers: [blocker("INVALID_DRIVER_EXECUTOR_SELECTION", "A local HAT leg requires a selected eligible driver, vehicle and resolved platform payout.")] };
          }
          const driver = await db.findEligibleLocalDriver(tx, leg, driverProfileId, vehicleId, now);
          if (!driver || !isDriverWithinPickupRadius(
            driver,
            { latitude: leg.originLatitude, longitude: leg.originLongitude },
            now,
            env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000,
          )) {
            return { blocked: true, blockers: [blocker("SELECTED_DRIVER_NO_LONGER_ELIGIBLE", "The selected driver, vehicle, coverage, availability or fresh pickup-radius location is no longer eligible.")] };
          }
          executionCostMinor = BigInt(assessment.execution.payoutAssessment.totalDriverPayoutMinor);
          costSource = "PLATFORM_DRIVER_PAYOUT_RULE";
          selected = { selectedDriverProfileId: driverProfileId, selectedVehicleId: vehicleId };
        } else if (executorType === "TRANSPORT_PARTNER") {
          if (!PARTNER_LEG_TYPES.has(leg.type) || !partnerId
            || assessment.execution?.mode !== "TRANSPORT_PARTNER") {
            return { blocked: true, blockers: [blocker("INVALID_PARTNER_EXECUTOR_SELECTION", "A partner-executed HAT leg requires a selected eligible partner rate-card candidate.")] };
          }
          const candidate = assessment.execution.partnerCandidates.find(item => item.partnerId === partnerId);
          if (!candidate) {
            return { blocked: true, blockers: [blocker("SELECTED_PARTNER_NO_LONGER_ELIGIBLE", "The selected partner no longer has one active rate card covering every package on this leg.")] };
          }
          executionCostMinor = BigInt(candidate.totalExecutionCostMinor);
          costSource = "PARTNER_RATE_CARD";
          costSourceVersion = candidate.rateCardVersion;
          selected = {
            selectedPartnerId: candidate.partnerId,
            partnerAgreementId: candidate.agreementId,
            partnerRateCardId: candidate.rateCardId,
          };
        } else {
          return { blocked: true, blockers: [blocker("UNSUPPORTED_EXECUTOR_TYPE", "The selected executor type is not supported for HAT legs.")] };
        }

        const latest = await tx.deliveryLegExecutionSnapshot.aggregate({
          where: { deliveryLegId },
          _max: { version: true },
        });
        const snapshot = await tx.deliveryLegExecutionSnapshot.create({
          data: {
            deliveryLegId,
            version: (latest._max.version ?? 0) + 1,
            idempotencyKey,
            payloadHash,
            executorType,
            ...selected,
            executionCostMinor,
            currency: assessment.currency,
            costSource,
            costSourceVersion,
            assessmentSnapshot: assessment,
            routeSnapshot: acceptedQuote?.inputSnapshot?.routeSnapshot ?? {},
            packageSnapshot: booking.parcelPackages.map(pkg => ({
              id: pkg.id, packageSequence: pkg.packageSequence, packageCategory: pkg.packageCategory,
              weightGrams: pkg.weightGrams, lengthMm: pkg.lengthMm, widthMm: pkg.widthMm, heightMm: pkg.heightMm,
            })),
            selectedByUserId,
            selectedAt: now,
          },
        });
        const updated = await tx.deliveryLeg.updateMany({
          where: { id: deliveryLegId, status: { in: ["PLANNED", "READY_FOR_ASSIGNMENT"] } },
          data: {
            status: "READY_FOR_ASSIGNMENT",
            metadata: {
              ...(leg.metadata ?? {}),
              executionReadiness: "READY",
              executionSnapshotId: snapshot.id,
              executionSnapshotVersion: snapshot.version,
              executionMode: executorType,
            },
          },
        });
        if (updated.count !== 1) {
          const error = new Error("The delivery leg changed while its executor snapshot was being selected.");
          error.statusCode = 409;
          error.code = "EXECUTION_SELECTION_STATE_CONFLICT";
          throw error;
        }
        await tx.operationalAuditEvent.create({
          data: {
            actorUserId: selectedByUserId,
            entityType: "DELIVERY_LEG_EXECUTION_SNAPSHOT",
            entityId: snapshot.id,
            action: "DELIVERY_LEG_EXECUTOR_SELECTED",
            after: {
              deliveryLegId, snapshotVersion: snapshot.version, executorType,
              ...selected, executionCostMinor: executionCostMinor.toString(),
              currency: assessment.currency, costSource, costSourceVersion,
            },
          },
        });
        return { snapshot, replay: false };
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        const existing = await prismaClient.deliveryLegExecutionSnapshot.findUnique({ where: { idempotencyKey } });
        if (!existing || existing.deliveryLegId !== deliveryLegId || existing.payloadHash !== payloadHash) {
          const conflictError = new Error("The idempotency key was already used for a different executor selection.");
          conflictError.statusCode = 409;
          conflictError.code = "IDEMPOTENCY_KEY_REUSED";
          throw conflictError;
        }
        return { snapshot: existing, replay: true };
      }
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
