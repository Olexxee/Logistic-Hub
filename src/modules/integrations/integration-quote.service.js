import { createHash, randomBytes } from "node:crypto";
import { resolveDeliveryRoute } from "../delivery-legs/delivery-route-planner.js";
import { assessPlatformRouteTariffs, rateFitsPackage } from "../platform-route-pricing/platform-route-tariff-assessment.service.js";
import { assessPlatformOperationalTariffs } from "../platform-operational-pricing/platform-operational-tariff-assessment.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}
function hashPayload(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function asMinor(value) { return value == null ? null : value.toString(); }
function sessionView(session) {
  return {
    id: session.id, externalReference: session.externalReference, status: session.status,
    billingAgreementReference: session.billingAgreement?.reference ?? null,
    billingModel: session.billingAgreement?.billingModel ?? null,
    billingAgreementVersion: session.billingAgreementVersion,
    currency: session.currency, expiresAt: session.expiresAt,
    assessment: session.assessmentSnapshot,
    selectedOptionId: session.selectedOptionId ?? null,
    packages: (session.packages ?? []).map(p => ({
      id: p.id, packageSequence: p.packageSequence, externalPackageRef: p.externalPackageRef, packageCategory: p.packageCategory,
      weightGrams: p.weightGrams, lengthMm: p.lengthMm, widthMm: p.widthMm, heightMm: p.heightMm,
      assessmentStatus: p.assessmentStatus, assessmentSource: p.assessmentSource,
    })),
    options: (session.options ?? []).map(optionView),
    createdAt: session.createdAt,
  };
}
function optionView(option) {
  return {
    id: option.id, optionCode: option.optionCode, status: option.status,
    currency: option.currency, logisticsCostMinor: option.logisticsCostMinor.toString(),
    platformChargeMinor: option.platformChargeMinor.toString(),
    otherChargesMinor: option.otherChargesMinor.toString(),
    customerChargeMinor: option.customerChargeMinor.toString(),
    estimatedTransitMinutes: option.estimatedTransitMinutes,
    routeMode: option.routeMode, route: option.routeSnapshot,
    expiresAt: option.expiresAt,
  };
}
async function serializableTransaction(prismaClient, work) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(work, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}
function serializeCached(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createIntegrationQuoteService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function replayOrConflict(tx, clientId, operation, key, payloadHash) {
    const existing = await tx.integrationIdempotencyRecord.findUnique({
      where: { clientId_operation_idempotencyKey: { clientId, operation, idempotencyKey: key } },
    });
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictError("The Idempotency-Key was reused with a different request payload.", "IDEMPOTENCY_CONFLICT");
    }
    if (existing.responseBody == null || existing.responseStatus == null) {
      throw new ConflictError("This idempotent request is still being processed. Retry shortly.", "IDEMPOTENCY_IN_PROGRESS");
    }
    return { statusCode: existing.responseStatus, body: existing.responseBody, replay: true };
  }

  async function storeIdempotency(tx, { clientId, operation, key, payloadHash, responseStatus, responseBody, now }) {
    await tx.integrationIdempotencyRecord.create({
      data: {
        clientId, operation, idempotencyKey: key, payloadHash,
        responseStatus, responseBody: serializeCached(responseBody), completedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  }

  async function activeAgreement(tx, clientId, reference, now) {
    const agreement = await tx.integrationBillingAgreement.findFirst({
      where: {
        clientId, reference, status: "ACTIVE",
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });
    if (!agreement) throw new ConflictError("No active billing agreement exists for this reference.", "INTEGRATION_BILLING_AGREEMENT_INACTIVE");
    if (agreement.billingModel !== "PLATFORM_COLLECTED") {
      throw new ConflictError("This quote endpoint currently supports PLATFORM_COLLECTED agreements only. Prepaid, invoice and Logistic Hub collection flows are not enabled.", "INTEGRATION_BILLING_MODEL_UNSUPPORTED");
    }
    return agreement;
  }

  async function buildOptions(tx, { packages, input, agreement, now, expiresAt }) {
    if (packages.some(pkg => pkg.weightGrams == null)) {
      return {
        status: "REQUIRES_MEASUREMENT",
        options: [],
        assessment: {
          status: "REQUIRES_MEASUREMENT",
          reason: "Weight is required for a defensible contracted-rate match. No estimated weight is generated.",
          packageCount: packages.length,
        },
      };
    }
    const route = await resolveDeliveryRoute({
      tx,
      booking: {
        pickupServiceZoneId: input.pickupServiceZoneId,
        destinationServiceZoneId: input.destinationServiceZoneId,
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        packages,
      },
    });
    const zoneById = new Map(route.zones.map(zone => [zone.id, zone]));
    const routeSnapshot = {
      routeMode: route.routeMode,
      origin: {
        serviceZoneId: input.pickupServiceZoneId,
        code: zoneById.get(input.pickupServiceZoneId).code,
        name: zoneById.get(input.pickupServiceZoneId).name,
        latitude: input.pickup.latitude,
        longitude: input.pickup.longitude,
      },
      destination: {
        serviceZoneId: input.destinationServiceZoneId,
        code: zoneById.get(input.destinationServiceZoneId).code,
        name: zoneById.get(input.destinationServiceZoneId).name,
        latitude: input.destination.latitude,
        longitude: input.destination.longitude,
      },
      hubAssisted: route.routeMode === "HUB_ASSISTED",
      legs: route.legs.map(leg => ({
        sequence: leg.sequence,
        type: leg.type,
        originServiceZoneId: leg.originServiceZoneId,
        destinationServiceZoneId: leg.destinationServiceZoneId,
        originHubPointId: leg.originHubPointId ?? null,
        destinationHubPointId: leg.destinationHubPointId ?? null,
        origin: { latitude: Number(leg.originLatitude), longitude: Number(leg.originLongitude) },
        destination: { latitude: Number(leg.destinationLatitude), longitude: Number(leg.destinationLongitude) },
      })),
      routePlanVersion: 1,
    };

    if (route.routeMode === "LOCAL_DIRECT") {
      return assessPlatformRouteTariffs({
        tx,
        originServiceZoneId: input.pickupServiceZoneId,
        destinationServiceZoneId: input.destinationServiceZoneId,
        packages,
        currency: agreement.currency,
        now,
        routeSnapshot,
        expiresAt,
      });
    }

    if (route.routeMode === "HUB_ASSISTED") {
      const operationalAssessment = await assessPlatformOperationalTariffs({
        tx, route, packages, currency: agreement.currency, now,
      });
      if (operationalAssessment.status !== "QUOTED") {
        const status = operationalAssessment.status === "NO_COVERAGE"
          ? "NO_COVERAGE"
          : operationalAssessment.status === "REQUIRES_MEASUREMENT"
            ? "REQUIRES_MEASUREMENT"
            : "REQUIRES_OPERATIONAL_PRICING";
        return {
          status,
          options: [],
          assessment: {
            ...operationalAssessment,
            source: "PLATFORM_OPERATIONAL_TARIFF",
          },
        };
      }
      const logisticsCost = BigInt(operationalAssessment.totals.customerChargeMinor);
      const platformCharge = BigInt(operationalAssessment.totals.platformChargeMinor);
      const customerCharge = BigInt(operationalAssessment.totals.totalCustomerChargeMinor);
      return {
        status: "QUOTED",
        assessment: {
          ...operationalAssessment,
          source: "PLATFORM_OPERATIONAL_TARIFF",
        },
        options: [{
          optionCode: "OPTION-01",
          currency: agreement.currency,
          logisticsCost,
          platformCharge,
          customerCharge,
          estimatedTransitMinutes: null,
          rateSnapshot: operationalAssessment.legs,
          routeSnapshot: operationalAssessment.routeSnapshot,
          expiresAt,
        }],
      };
    }

    // END_TO_END remains the contracted partner-rate path. No other route mode
    // may fall through to legacy pricing or a direct-corridor tariff.
    if (route.routeMode !== "END_TO_END") {
      return {
        status: "REQUIRES_OPERATIONAL_PRICING",
        options: [],
        assessment: {
          status: "REQUIRES_OPERATIONAL_PRICING",
          packageCount: packages.length,
          routeMode: route.routeMode,
          reason: route.routeMode === "LOCAL_DIRECT"
            ? "Local delivery currently relies on driver fare negotiation. A fixed integration price is not available."
            : "The operational route requires local pickup and final-mile execution charges that are not yet included in contracted integration pricing.",
          routeSnapshot,
          assessedAt: now.toISOString(),
        },
      };
    }

    const pricingRules = await tx.pricingRule.findMany({
      where: {
        serviceType: "PARCEL_DELIVERY", isActive: true, currency: agreement.currency,
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
        OR: [{ serviceZoneId: input.pickupServiceZoneId }, { serviceZoneId: null }],
      },
      orderBy: [{ serviceZoneId: "desc" }, { version: "desc" }],
    });
    const pricingRule = pricingRules.find(rule => rule.serviceZoneId === input.pickupServiceZoneId)
      ?? pricingRules.find(rule => rule.serviceZoneId == null);
    if (!pricingRule) throw new ConflictError("No active platform parcel pricing rule matches this billing agreement currency.", "INTEGRATION_PLATFORM_PRICING_UNAVAILABLE");

    const rates = await tx.partnerRate.findMany({
      where: {
        originServiceZoneId: input.pickupServiceZoneId,
        destinationServiceZoneId: input.destinationServiceZoneId,
        serviceType: "PARCEL_DELIVERY", isActive: true,
        parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory))] },
        rateCard: {
          status: "ACTIVE", currency: agreement.currency,
          effectiveFrom: { lte: now },
          AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
          agreement: {
            status: "ACTIVE", currency: agreement.currency,
            effectiveFrom: { lte: now },
            AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
            partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
          },
        },
      },
      include: {
        rateCard: {
          include: {
            agreement: { include: { partner: { select: { id: true, displayName: true } } } },
          },
        },
      },
      orderBy: [{ rateCardId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    const byCard = new Map();
    for (const rate of rates) {
      const list = byCard.get(rate.rateCardId) ?? [];
      list.push(rate);
      byCard.set(rate.rateCardId, list);
    }
    const candidates = [];
    for (const [rateCardId, cardRates] of byCard) {
      const packageMatches = [];
      let valid = true;
      for (const pkg of packages) {
        const matches = cardRates.filter(rate => rate.parcelCategory === pkg.packageCategory && rateFitsPackage(rate, pkg));
        if (matches.length !== 1) { valid = false; break; }
        packageMatches.push({ packageRef: pkg.externalPackageRef ?? `package-${packages.indexOf(pkg) + 1}`, externalPackageRef: pkg.externalPackageRef ?? null, rate: matches[0] });
      }
      if (!valid) continue;
      const logisticsCost = packageMatches.reduce((sum, item) => sum + item.rate.transportChargeMinor, 0n);
      const platformCharge = pricingRule.fixedConnectionFeeMinor;
      const customerCharge = logisticsCost + platformCharge;
      const transit = packageMatches.map(item => item.rate.estimatedTransitMinutes).filter(Number.isInteger);
      candidates.push({
        rateCardId,
        agreementId: cardRates[0].rateCard.agreementId,
        currency: agreement.currency,
        logisticsCost,
        platformCharge,
        customerCharge,
        estimatedTransitMinutes: transit.length ? Math.max(...transit) : null,
        rateSnapshot: packageMatches.map(item => ({
          packageRef: item.packageRef, externalPackageRef: item.externalPackageRef,
          rateId: item.rate.id, transportChargeMinor: item.rate.transportChargeMinor.toString(),
          estimatedTransitMinutes: item.rate.estimatedTransitMinutes,
        })),
        partnerLabel: cardRates[0].rateCard.agreement.partner.displayName,
        rateCardVersion: cardRates[0].rateCard.version,
      });
    }
    candidates.sort((a, b) => a.customerCharge < b.customerCharge ? -1
      : a.customerCharge > b.customerCharge ? 1 : a.rateCardId.localeCompare(b.rateCardId));
    return {
      status: candidates.length ? "QUOTED" : "NO_COVERAGE",
      assessment: {
        status: candidates.length ? "DECLARED" : "NO_COVERAGE",
        packageCount: packages.length,
        source: "INTEGRATOR_DECLARED",
        operationalPlanStatus: "FULLY_PRICED",
        routeSnapshot,
        assessedAt: now.toISOString(),
      },
      options: candidates.slice(0, 10).map((candidate, index) => ({
        ...candidate, optionCode: `OPTION-${String(index + 1).padStart(2, "0")}`,
        routeSnapshot, expiresAt,
      })),
    };
  }

  return {
    async createQuote({ client, idempotencyKey, input }) {
      const now = clock();
      const payloadHash = hashPayload(input);
      const operation = "integration.quote.create";
      try {
        return await serializableTransaction(prismaClient, async tx => {
          const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
          if (replay) return replay;
          const agreement = await activeAgreement(tx, client.id, input.billingAgreementReference, now);
          const expiresAt = new Date(now.getTime() + input.expiresInMinutes * 60_000);
          const assessment = await buildOptions(tx, { packages: input.packages, input, agreement, now, expiresAt });
          const session = await tx.integrationQuoteSession.create({
            data: {
              clientId: client.id, billingAgreementId: agreement.id, billingAgreementVersion: agreement.version,
              externalReference: input.externalReference, idempotencyKey, payloadHash,
              status: assessment.status, currency: agreement.currency,
              pickupServiceZoneId: input.pickupServiceZoneId, destinationServiceZoneId: input.destinationServiceZoneId,
              pickupAddress: input.pickupAddress, pickupLatitude: input.pickup.latitude, pickupLongitude: input.pickup.longitude,
              destinationAddress: input.destinationAddress, destinationLatitude: input.destination.latitude, destinationLongitude: input.destination.longitude,
              recipientName: input.recipientName, recipientPhone: input.recipientPhone,
              expiresAt, assessmentSnapshot: assessment.assessment,
              packages: { create: input.packages.map((pkg, index) => ({
                packageSequence: index + 1,
                externalPackageRef: pkg.externalPackageRef, packageCategory: pkg.packageCategory,
                description: pkg.description, weightGrams: pkg.weightGrams,
                lengthMm: pkg.lengthMm, widthMm: pkg.widthMm, heightMm: pkg.heightMm,
                declaredValueMinor: pkg.declaredValueMinor == null ? undefined : BigInt(pkg.declaredValueMinor),
                assessmentStatus: pkg.weightGrams == null ? "REQUIRES_MEASUREMENT" : "DECLARED",
                assessmentSource: "INTEGRATOR_DECLARED", assessedAt: now,
              })) },
            },
          });
          const options = [];
          for (const candidate of assessment.options) {
            const option = await tx.integrationQuoteOption.create({
              data: {
                quoteSessionId: session.id, optionCode: candidate.optionCode,
                partnerAgreementId: candidate.agreementId ?? null, partnerRateCardId: candidate.rateCardId ?? null,
                driverPayoutMinor: candidate.driverPayout ?? null,
                currency: candidate.currency, logisticsCostMinor: candidate.logisticsCost,
                platformChargeMinor: candidate.platformCharge, otherChargesMinor: 0n,
                customerChargeMinor: candidate.customerCharge, estimatedTransitMinutes: candidate.estimatedTransitMinutes,
                routeMode: candidate.routeSnapshot.routeMode,
                packageRateSnapshot: candidate.rateSnapshot, routeSnapshot: candidate.routeSnapshot,
                expiresAt,
              },
            });
            options.push(option);
          }
          await tx.integrationExternalReference.create({
            data: {
              clientId: client.id, resourceType: "QUOTE_SESSION", externalReference: input.externalReference,
              internalResourceType: "IntegrationQuoteSession", internalResourceId: session.id,
            },
          });
          const responseBody = {
            quoteSession: {
              id: session.id, externalReference: session.externalReference, status: session.status,
              billingAgreementReference: agreement.reference, billingAgreementVersion: agreement.version, billingModel: agreement.billingModel,
              currency: agreement.currency, expiresAt: session.expiresAt, assessment: assessment.assessment,
            },
            packages: input.packages.map((pkg, index) => ({
              packageSequence: index + 1,
              externalPackageRef: pkg.externalPackageRef ?? null, packageCategory: pkg.packageCategory,
              weightGrams: pkg.weightGrams ?? null, lengthMm: pkg.lengthMm ?? null,
              widthMm: pkg.widthMm ?? null, heightMm: pkg.heightMm ?? null,
              assessmentStatus: pkg.weightGrams == null ? "REQUIRES_MEASUREMENT" : "DECLARED",
            })),
            options: options.map(optionView),
          };
          await storeIdempotency(tx, {
            clientId: client.id, operation, key: idempotencyKey, payloadHash,
            responseStatus: 201, responseBody, now,
          });
          return { statusCode: 201, body: responseBody, replay: false };
        });
      } catch (error) {
        if (error?.code === "P2002") {
          const existing = await prismaClient.integrationIdempotencyRecord.findUnique({
            where: { clientId_operation_idempotencyKey: { clientId: client.id, operation, idempotencyKey } },
          });
          if (existing) {
            if (existing.payloadHash !== payloadHash) throw new ConflictError("The Idempotency-Key was reused with a different request payload.", "IDEMPOTENCY_CONFLICT");
            if (existing.responseBody) return { statusCode: existing.responseStatus ?? 201, body: existing.responseBody, replay: true };
          }
          const duplicateExternal = await prismaClient.integrationQuoteSession.findUnique({
            where: { clientId_externalReference: { clientId: client.id, externalReference: input.externalReference } },
          });
          if (duplicateExternal) throw new ConflictError("This externalReference already belongs to a quote session. Use the original idempotency key to replay.", "EXTERNAL_REFERENCE_CONFLICT");
        }
        throw error;
      }
    },

    async getQuote({ clientId, quoteSessionId }) {
      const now = clock();
      const current = await prismaClient.integrationQuoteSession.findFirst({
        where: { id: quoteSessionId, clientId },
        select: { id: true, status: true, expiresAt: true },
      });
      if (!current) throw new NotFoundError("Quote session not found.", "INTEGRATION_QUOTE_NOT_FOUND");
      if (current.status === "QUOTED" && current.expiresAt <= now) {
        await prismaClient.$transaction(async tx => {
          await tx.integrationQuoteSession.updateMany({
            where: { id: current.id, clientId, status: "QUOTED", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
          await tx.integrationQuoteOption.updateMany({
            where: { quoteSessionId: current.id, status: "AVAILABLE", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
        });
      }
      const session = await prismaClient.integrationQuoteSession.findFirst({
        where: { id: quoteSessionId, clientId },
        include: { billingAgreement: { select: { reference: true, billingModel: true } }, packages: { orderBy: { packageSequence: "asc" } }, options: { orderBy: [{ customerChargeMinor: "asc" }, { optionCode: "asc" }] } },
      });
      if (!session) throw new NotFoundError("Quote session not found.", "INTEGRATION_QUOTE_NOT_FOUND");
      return sessionView(session);
    },

    async acceptOption({ client, quoteSessionId, optionId, idempotencyKey }) {
      const now = clock();
      const input = { quoteSessionId, optionId };
      const payloadHash = hashPayload(input);
      const operation = `integration.quote.accept:${quoteSessionId}`;
      try {
        return await prismaClient.$transaction(async tx => {
          const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
          if (replay) return replay;
          const session = await tx.integrationQuoteSession.findFirst({
            where: { id: quoteSessionId, clientId: client.id },
            include: {
              packages: { orderBy: { packageSequence: "asc" } },
              billingAgreement: { select: { reference: true } },
            },
          });
          if (!session) throw new NotFoundError("Quote session not found.", "INTEGRATION_QUOTE_NOT_FOUND");
          if (session.status !== "QUOTED" || session.expiresAt <= now) {
            if (session.expiresAt <= now && session.status === "QUOTED") {
              await tx.integrationQuoteSession.updateMany({ where: { id: session.id, status: "QUOTED" }, data: { status: "EXPIRED" } });
              await tx.integrationQuoteOption.updateMany({ where: { quoteSessionId: session.id, status: "AVAILABLE" }, data: { status: "EXPIRED" } });
            }
            throw new ConflictError("This quote session is expired or has already been selected.", "INTEGRATION_QUOTE_NOT_SELECTABLE");
          }
          const option = await tx.integrationQuoteOption.findFirst({
            where: { id: optionId, quoteSessionId: session.id, status: "AVAILABLE", expiresAt: { gt: now } },
          });
          if (!option) throw new ConflictError("The selected quote option is no longer available.", "INTEGRATION_QUOTE_OPTION_UNAVAILABLE");

          if (option.routeMode === "HUB_ASSISTED") {
            const agreement = await activeAgreement(tx, client.id, session.billingAgreement.reference, now);
            if (agreement.version !== session.billingAgreementVersion || agreement.currency !== session.currency) {
              throw new ConflictError("The integration billing agreement changed after quote issuance. Request a fresh quote.", "INTEGRATION_BILLING_AGREEMENT_CHANGED");
            }
            const packages = session.packages.map(pkg => ({
              externalPackageRef: pkg.externalPackageRef,
              packageCategory: pkg.packageCategory,
              weightGrams: pkg.weightGrams,
              lengthMm: pkg.lengthMm,
              widthMm: pkg.widthMm,
              heightMm: pkg.heightMm,
            }));
            const fresh = await buildOptions(tx, {
              packages,
              input: {
                pickupServiceZoneId: session.pickupServiceZoneId,
                destinationServiceZoneId: session.destinationServiceZoneId,
                pickup: { latitude: Number(session.pickupLatitude), longitude: Number(session.pickupLongitude) },
                destination: { latitude: Number(session.destinationLatitude), longitude: Number(session.destinationLongitude) },
              },
              agreement,
              now,
              expiresAt: session.expiresAt,
            });
            const refreshed = fresh.options?.find(candidate => candidate.optionCode === option.optionCode);
            if (!refreshed || fresh.status !== "QUOTED") {
              throw new ConflictError("Operational tariff coverage changed after quote issuance. Request a fresh quote.", "OPERATIONAL_TARIFF_CHANGED");
            }
            if (hashPayload(option.routeSnapshot) !== hashPayload(refreshed.routeSnapshot)) {
              throw new ConflictError("The resolved hub-assisted route changed after quote issuance. Request a fresh quote.", "OPERATIONAL_ROUTE_CHANGED");
            }
            if (hashPayload(option.packageRateSnapshot) !== hashPayload(refreshed.rateSnapshot)
              || option.currency !== refreshed.currency
              || option.logisticsCostMinor.toString() !== refreshed.logisticsCost.toString()
              || option.platformChargeMinor.toString() !== refreshed.platformCharge.toString()
              || option.customerChargeMinor.toString() !== refreshed.customerCharge.toString()) {
              throw new ConflictError("Operational tariff amounts or versions changed after quote issuance. Request a fresh quote.", "OPERATIONAL_TARIFF_CHANGED");
            }
          }

          const updatedSession = await tx.integrationQuoteSession.updateMany({
            where: { id: session.id, clientId: client.id, status: "QUOTED", expiresAt: { gt: now } },
            data: { status: "SELECTED", selectedOptionId: option.id },
          });
          if (updatedSession.count !== 1) throw new ConflictError("The quote session changed while selection was being processed.", "INTEGRATION_QUOTE_NOT_SELECTABLE");
          await tx.integrationQuoteOption.update({ where: { id: option.id }, data: { status: "SELECTED", selectedAt: now } });
          await tx.integrationQuoteOption.updateMany({
            where: { quoteSessionId: session.id, id: { not: option.id }, status: "AVAILABLE" },
            data: { status: "REJECTED" },
          });
          const body = { quoteSessionId: session.id, externalReference: session.externalReference, status: "SELECTED", selectedOption: optionView({ ...option, status: "SELECTED", selectedAt: now }) };
          await storeIdempotency(tx, { clientId: client.id, operation, key: idempotencyKey, payloadHash, responseStatus: 200, responseBody: body, now });
          return { statusCode: 200, body, replay: false };
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (error?.code === "P2002") {
          const existing = await prismaClient.integrationIdempotencyRecord.findUnique({
            where: { clientId_operation_idempotencyKey: { clientId: client.id, operation, idempotencyKey } },
          });
          if (existing?.payloadHash === payloadHash && existing.responseBody) {
            return { statusCode: existing.responseStatus ?? 200, body: existing.responseBody, replay: true };
          }
          if (existing) throw new ConflictError("The Idempotency-Key was reused with a different request payload.", "IDEMPOTENCY_CONFLICT");
        }
        throw error;
      }
    },
  };
}
