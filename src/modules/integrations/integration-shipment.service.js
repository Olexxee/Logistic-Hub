import { createHash, randomBytes } from "node:crypto";
import { createMultiLegPlan } from "../delivery-legs/delivery-plan.service.js";
import { ConflictError, NotFoundError } from "../../shared/http/app-error.js";
import { projectIntegrationShipmentEvent } from "./integration-shipment-events.projector.js";

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
function serializeCached(value) {
  return JSON.parse(JSON.stringify(value));
}
function publicReference() {
  return `LH-PCL-${randomBytes(6).toString("hex").toUpperCase()}`;
}
function activeAt(now) {
  return {
    effectiveFrom: { lte: now },
    AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
  };
}
function packageRateFits(rate, pkg) {
  if (rate.parcelCategory !== pkg.packageCategory || pkg.weightGrams == null
    || pkg.weightGrams < rate.minWeightGrams
    || (rate.maxWeightGrams != null && pkg.weightGrams > rate.maxWeightGrams)) return false;
  for (const [field, limit] of [
    ["lengthMm", rate.maxLengthMm], ["widthMm", rate.maxWidthMm], ["heightMm", rate.maxHeightMm],
  ]) {
    if (limit != null && (pkg[field] == null || pkg[field] > limit)) return false;
  }
  return true;
}
async function serializableTransaction(prismaClient, work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prismaClient.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

export function createIntegrationShipmentService({ prismaClient, clock = () => new Date() }) {
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

  async function revalidateSelectedQuote(tx, { clientId, quoteSessionId, quoteOptionId, externalFulfillmentReference, now }) {
    const session = await tx.integrationQuoteSession.findFirst({
      where: { id: quoteSessionId, clientId },
      include: {
        billingAgreement: true,
        packages: { orderBy: { packageSequence: "asc" } },
        options: { where: { id: quoteOptionId }, take: 1 },
      },
    });
    if (!session) throw new NotFoundError("Quote session not found.", "INTEGRATION_QUOTE_NOT_FOUND");
    if (session.externalReference !== externalFulfillmentReference) {
      throw new ConflictError("The external fulfilment reference does not match the reference bound to this quote.", "INTEGRATION_FULFILLMENT_REFERENCE_MISMATCH");
    }
    if (session.status !== "SELECTED" || session.selectedOptionId !== quoteOptionId) {
      throw new ConflictError("Only the selected option on an unbooked quote can create a shipment.", "INTEGRATION_QUOTE_NOT_SELECTED");
    }
    if (session.expiresAt <= now) {
      throw new ConflictError("The selected quote session has expired.", "INTEGRATION_QUOTE_EXPIRED");
    }

    const option = session.options[0];
    if (!option || option.status !== "SELECTED" || option.expiresAt <= now) {
      throw new ConflictError("The selected quote option is no longer valid.", "INTEGRATION_QUOTE_OPTION_UNAVAILABLE");
    }
    if (!["END_TO_END", "LOCAL_DIRECT"].includes(option.routeMode)
      || option.routeSnapshot?.routeMode !== option.routeMode) {
      throw new ConflictError("This quote route is not enabled for integration shipment creation.", "INTEGRATION_ROUTE_NOT_SUPPORTED");
    }

    const billingAgreement = await tx.integrationBillingAgreement.findFirst({
      where: {
        id: session.billingAgreementId,
        clientId,
        reference: session.billingAgreement.reference,
        version: session.billingAgreementVersion,
        status: "ACTIVE",
        billingModel: "PLATFORM_COLLECTED",
        ...activeAt(now),
      },
    });
    if (!billingAgreement) {
      throw new ConflictError("The billing agreement is no longer active for shipment creation.", "INTEGRATION_BILLING_AGREEMENT_INACTIVE");
    }

    if (option.routeMode === "LOCAL_DIRECT") {
      const availability = await tx.platformRouteAvailability.findFirst({
        where: {
          originServiceZoneId: session.pickupServiceZoneId,
          destinationServiceZoneId: session.destinationServiceZoneId,
          serviceType: "PARCEL_DELIVERY", isEnabled: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        },
      });
      if (!availability) throw new ConflictError("The directed platform route is no longer available.", "PLATFORM_ROUTE_UNAVAILABLE");
      const snapshots = Array.isArray(option.packageRateSnapshot) ? option.packageRateSnapshot : [];
      if (!session.packages.length || snapshots.length !== session.packages.length) {
        throw new ConflictError("The platform tariff snapshot is incomplete.", "INTEGRATION_QUOTE_SNAPSHOT_INVALID");
      }
      const rateIds = snapshots.map(item => item?.rateId);
      if (rateIds.some(id => typeof id !== "string") || new Set(rateIds).size !== rateIds.length) {
        throw new ConflictError("The platform tariff snapshot contains invalid rate references.", "INTEGRATION_QUOTE_SNAPSHOT_INVALID");
      }
      const platformRates = await tx.platformRouteRate.findMany({
        where: {
          id: { in: rateIds }, originServiceZoneId: session.pickupServiceZoneId,
          destinationServiceZoneId: session.destinationServiceZoneId,
          serviceType: "PARCEL_DELIVERY", status: "ACTIVE", currency: option.currency,
          ...activeAt(now),
        },
      });
      const platformRatesById = new Map(platformRates.map(rate => [rate.id, rate]));
      if (platformRatesById.size !== rateIds.length) {
        throw new ConflictError("A platform tariff used by this quote is no longer active.", "PLATFORM_ROUTE_RATE_INACTIVE");
      }
      let transportTotal = 0n;
      let platformTotal = 0n;
      let driverPayoutTotal = 0n;
      for (let index = 0; index < session.packages.length; index += 1) {
        const pkg = session.packages[index];
        const snapshot = snapshots[index];
        const expectedRef = pkg.externalPackageRef ?? `package-${pkg.packageSequence + 1}`;
        const rate = platformRatesById.get(snapshot.rateId);
        if (snapshot.packageRef !== expectedRef
          || (snapshot.externalPackageRef ?? null) !== (pkg.externalPackageRef ?? null)
          || !rate || !packageRateFits(rate, pkg)
          || rate.version !== snapshot.rateVersion
          || rate.customerTransportChargeMinor.toString() !== snapshot.customerTransportChargeMinor
          || rate.platformChargeMinor.toString() !== snapshot.platformChargeMinor
          || rate.driverPayoutMinor.toString() !== snapshot.driverPayoutMinor) {
          throw new ConflictError("A platform tariff no longer matches the immutable quote snapshot.", "PLATFORM_ROUTE_RATE_INACTIVE");
        }
        transportTotal += rate.customerTransportChargeMinor;
        platformTotal += rate.platformChargeMinor;
        driverPayoutTotal += rate.driverPayoutMinor;
      }
      if (transportTotal !== option.logisticsCostMinor || platformTotal !== option.platformChargeMinor
        || option.driverPayoutMinor !== driverPayoutTotal
        || transportTotal + platformTotal + option.otherChargesMinor !== option.customerChargeMinor) {
        throw new ConflictError("The platform quote totals do not reconcile with the accepted tariff snapshots.", "INTEGRATION_QUOTE_TOTAL_MISMATCH");
      }
      const zoneIds = [...new Set([session.pickupServiceZoneId, session.destinationServiceZoneId])];
      const activeZones = await tx.serviceZone.findMany({
        where: {
          id: { in: zoneIds }, isActive: true,
          state: { isActive: true, country: { isActive: true } },
          availability: { some: { serviceType: "PARCEL_DELIVERY", isEnabled: true, AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ] } },
        },
        select: { id: true },
      });
      if (activeZones.length !== zoneIds.length) {
        throw new ConflictError("One or both shipment zones are no longer active for parcel delivery.", "SERVICE_ZONE_UNAVAILABLE");
      }
      return { session, option, billingAgreement, rateCard: null, packageRates: snapshots, ratesById: new Map() };
    }

    const rateCard = await tx.partnerRateCard.findFirst({
      where: {
        id: option.partnerRateCardId,
        agreementId: option.partnerAgreementId,
        status: "ACTIVE",
        currency: option.currency,
        ...activeAt(now),
        agreement: {
          status: "ACTIVE",
          currency: option.currency,
          ...activeAt(now),
          partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        },
      },
      include: { agreement: { include: { partner: true } } },
    });
    if (!rateCard || rateCard.agreementId !== option.partnerAgreementId) {
      throw new ConflictError("The contracted partner rate card or agreement is no longer eligible.", "INTEGRATION_PARTNER_AGREEMENT_INACTIVE");
    }

    const packageRates = Array.isArray(option.packageRateSnapshot) ? option.packageRateSnapshot : [];
    if (!session.packages.length || packageRates.length !== session.packages.length) {
      throw new ConflictError("The quote package-rate snapshot is incomplete.", "INTEGRATION_QUOTE_SNAPSHOT_INVALID");
    }
    const rateIds = [...new Set(packageRates.map(item => item?.rateId).filter(value => typeof value === "string"))];
    if (!rateIds.length || rateIds.length !== new Set(packageRates.map(item => item?.rateId)).size) {
      throw new ConflictError("The quote package-rate snapshot contains invalid rate references.", "INTEGRATION_QUOTE_SNAPSHOT_INVALID");
    }
    const rates = await tx.partnerRate.findMany({
      where: { id: { in: rateIds }, rateCardId: rateCard.id, isActive: true },
    });
    const ratesById = new Map(rates.map(rate => [rate.id, rate]));
    if (ratesById.size !== rateIds.length) {
      throw new ConflictError("One or more contracted package rates are no longer active.", "INTEGRATION_PARTNER_RATE_INACTIVE");
    }

    let logisticsTotal = 0n;
    for (let index = 0; index < session.packages.length; index += 1) {
      const pkg = session.packages[index];
      const snapshot = packageRates[index];
      const expectedRef = pkg.externalPackageRef ?? `package-${pkg.packageSequence + 1}`;
      if (snapshot.packageRef !== expectedRef
        || (snapshot.externalPackageRef ?? null) !== (pkg.externalPackageRef ?? null)) {
        throw new ConflictError("The quote package-rate snapshot no longer matches its package records.", "INTEGRATION_QUOTE_SNAPSHOT_INVALID");
      }
      const rate = ratesById.get(snapshot.rateId);
      if (!rate || !packageRateFits(rate, pkg)
        || rate.transportChargeMinor.toString() !== snapshot.transportChargeMinor) {
        throw new ConflictError("A quoted package rate no longer matches the accepted package snapshot.", "INTEGRATION_PARTNER_RATE_INACTIVE");
      }
      logisticsTotal += rate.transportChargeMinor;
    }
    if (logisticsTotal !== option.logisticsCostMinor
      || option.logisticsCostMinor + option.platformChargeMinor + option.otherChargesMinor !== option.customerChargeMinor) {
      throw new ConflictError("The selected quote totals do not reconcile with their immutable rate snapshots.", "INTEGRATION_QUOTE_TOTAL_MISMATCH");
    }

    const zoneIds = [...new Set([session.pickupServiceZoneId, session.destinationServiceZoneId])];
    const activeZones = await tx.serviceZone.findMany({
      where: {
        id: { in: zoneIds },
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
      select: { id: true },
    });
    if (activeZones.length !== zoneIds.length) {
      throw new ConflictError("One or both shipment zones are no longer active for parcel delivery.", "SERVICE_ZONE_UNAVAILABLE");
    }

    return { session, option, billingAgreement, rateCard, packageRates, ratesById };
  }

  return {
    async freezePackingEvidence({ client, idempotencyKey, externalFulfillmentReference }) {
      const now = clock();
      const operation = "integration.shipment.packing-evidence.freeze";
      const input = { externalFulfillmentReference };
      const payloadHash = hashPayload(input);
      return serializableTransaction(prismaClient, async tx => {
        const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
        if (replay) return { ...replay, replay: true };

        const external = await tx.integrationExternalReference.findFirst({
          where: {
            clientId: client.id,
            resourceType: "SHIPMENT",
            externalReference: externalFulfillmentReference,
          },
          select: { internalResourceId: true },
        });
        if (!external) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");

        const booking = await tx.parcelBooking.findFirst({
          where: { id: external.internalResourceId, integrationClientId: client.id },
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            integrationPackingEvidenceFrozenAt: true,
          },
        });
        if (!booking) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
        if (booking.paymentStatus !== "SUCCEEDED" || booking.status !== "AWAITING_PARTNER_ASSIGNMENT") {
          throw new ConflictError("Packing evidence can only be frozen before partner assignment on a paid shipment.", "INTEGRATION_SHIPMENT_NOT_FREEZABLE");
        }
        await tx.$queryRaw`SELECT "id" FROM "parcel_bookings" WHERE "id" = ${booking.id} FOR UPDATE`;
        const lockedBooking = await tx.parcelBooking.findUnique({
          where: { id: booking.id },
          select: { integrationPackingEvidenceFrozenAt: true, status: true, paymentStatus: true },
        });
        if (lockedBooking?.status !== "AWAITING_PARTNER_ASSIGNMENT" || lockedBooking.paymentStatus !== "SUCCEEDED") {
          throw new ConflictError("The shipment changed before packing evidence could be frozen.", "INTEGRATION_PACKING_EVIDENCE_FREEZE_CONFLICT");
        }

        const evidence = await tx.integrationPackingEvidence.findMany({
          where: { clientId: client.id, parcelBookingId: booking.id },
          select: { slot: true },
        });
        const slots = new Set(evidence.map(item => item.slot));
        const required = ["CONTENTS_OVERVIEW", "PRODUCT_DETAILS", "QUANTITY_CHECK", "SEALED_PARCEL"];
        if (!required.every(slot => slots.has(slot))) {
          throw new ConflictError("All four required packing evidence slots must be accepted before the evidence can be frozen.", "INTEGRATION_PACKING_EVIDENCE_INCOMPLETE");
        }

        let frozenAt = lockedBooking.integrationPackingEvidenceFrozenAt;
        if (!frozenAt) {
          const changed = await tx.parcelBooking.updateMany({
            where: {
              id: booking.id,
              integrationClientId: client.id,
              status: "AWAITING_PARTNER_ASSIGNMENT",
              paymentStatus: "SUCCEEDED",
              integrationPackingEvidenceFrozenAt: null,
            },
            data: { integrationPackingEvidenceFrozenAt: now },
          });
          if (changed.count !== 1) {
            throw new ConflictError("The shipment changed before packing evidence could be frozen.", "INTEGRATION_PACKING_EVIDENCE_FREEZE_CONFLICT");
          }
          frozenAt = now;
          await tx.bookingEvent.create({
            data: {
              parcelBookingId: booking.id,
              eventType: "INTEGRATION_PACKING_EVIDENCE_FROZEN",
              metadata: {
                integrationClientId: client.id,
                externalFulfillmentReference,
                frozenAt: now.toISOString(),
                requiredSlots: required,
              },
            },
          });
        }

        const responseBody = {
          shipmentId: booking.id,
          externalFulfillmentReference,
          frozenAt,
          requiredSlots: required,
        };
        await storeIdempotency(tx, {
          clientId: client.id, operation, key: idempotencyKey, payloadHash,
          responseStatus: 200, responseBody, now,
        });
        return { statusCode: 200, body: responseBody, replay: false };
      });
    },

    async authorizeDispatch({ client, idempotencyKey, externalFulfillmentReference, reason }) {
      const now = clock();
      const operation = "integration.shipment.dispatch-authorize";
      const input = { externalFulfillmentReference, reason };
      const payloadHash = hashPayload(input);
      return serializableTransaction(prismaClient, async tx => {
        const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
        if (replay) return { ...replay, replay: true };

        const external = await tx.integrationExternalReference.findFirst({
          where: {
            clientId: client.id,
            resourceType: "SHIPMENT",
            externalReference: externalFulfillmentReference,
          },
          select: { internalResourceId: true },
        });
        if (!external) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");

        const booking = await tx.parcelBooking.findFirst({
          where: { id: external.internalResourceId, integrationClientId: client.id },
          include: { deliveryLegs: { select: { id: true, type: true, status: true } } },
        });
        if (!booking) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
        if (booking.paymentStatus !== "SUCCEEDED") {
          throw new ConflictError("Dispatch cannot be authorized before payment is confirmed.", "INTEGRATION_SHIPMENT_NOT_PAID");
        }
        if (booking.status !== "AWAITING_PARTNER_ASSIGNMENT") {
          throw new ConflictError("Dispatch authorization is only available before partner assignment.", "INTEGRATION_SHIPMENT_NOT_AWAITING_ASSIGNMENT");
        }
        if (!booking.deliveryLegs.length || booking.deliveryLegs.some(leg =>
          leg.type !== "INTERSTATE_TRANSPORT" || leg.status !== "READY_FOR_ASSIGNMENT"
        )) {
          throw new ConflictError("Every partner-executed delivery leg must still be ready for assignment.", "INTEGRATION_SHIPMENT_ASSIGNMENT_ALREADY_STARTED");
        }

        if (booking.integrationDispatchAuthorizedAt) {
          const responseBody = {
            shipmentId: booking.id,
            externalFulfillmentReference,
            dispatchAuthorizedAt: booking.integrationDispatchAuthorizedAt,
            reason: "ALREADY_AUTHORIZED",
          };
          await storeIdempotency(tx, {
            clientId: client.id, operation, key: idempotencyKey, payloadHash,
            responseStatus: 200, responseBody, now,
          });
          return { statusCode: 200, body: responseBody, replay: false };
        }

        const changed = await tx.parcelBooking.updateMany({
          where: {
            id: booking.id,
            integrationClientId: client.id,
            status: "AWAITING_PARTNER_ASSIGNMENT",
            paymentStatus: "SUCCEEDED",
            integrationDispatchAuthorizedAt: null,
          },
          data: { integrationDispatchAuthorizedAt: now },
        });
        if (changed.count !== 1) {
          throw new ConflictError("The shipment changed before dispatch authorization could be recorded.", "INTEGRATION_DISPATCH_AUTHORIZATION_CONFLICT");
        }

        await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            eventType: "INTEGRATION_DISPATCH_AUTHORIZED",
            fromStatus: booking.status,
            toStatus: booking.status,
            metadata: {
              integrationClientId: client.id,
              externalFulfillmentReference,
              reason,
              authorizedAt: now.toISOString(),
            },
          },
        });

        const responseBody = {
          shipmentId: booking.id,
          externalFulfillmentReference,
          dispatchAuthorizedAt: now,
          reason,
        };
        await storeIdempotency(tx, {
          clientId: client.id, operation, key: idempotencyKey, payloadHash,
          responseStatus: 200, responseBody, now,
        });
        return { statusCode: 200, body: responseBody, replay: false };
      });
    },

    async stopShipment({ client, idempotencyKey, externalFulfillmentReference, reason }) {
      const now = clock();
      const operation = "integration.shipment.stop";
      const input = { externalFulfillmentReference, reason };
      const payloadHash = hashPayload(input);
      return serializableTransaction(prismaClient, async tx => {
        const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
        if (replay) return { ...replay, replay: true };

        const external = await tx.integrationExternalReference.findFirst({
          where: { clientId: client.id, resourceType: "SHIPMENT", externalReference: externalFulfillmentReference },
          select: { internalResourceId: true },
        });
        if (!external) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");

        const booking = await tx.parcelBooking.findFirst({
          where: { id: external.internalResourceId, integrationClientId: client.id },
          include: {
            deliveryLegs: { select: { id: true, status: true } },
            custodyHandovers: { where: { status: { in: ["CONFIRMED", "PENDING_CONFIRMATION"] } }, select: { id: true, status: true, fromPartyType: true, toPartyType: true, fromPartyId: true, toPartyId: true, confirmedAt: true } },
          },
        });
        if (!booking) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
        if (booking.paymentStatus !== "SUCCEEDED" || !booking.deliveryLegs.length) {
          throw new ConflictError("The integration shipment is missing its paid booking or delivery-leg prerequisites for a safe stop.", "INTEGRATION_SHIPMENT_STOP_PREREQUISITES_MISSING");
        }
        if (booking.status === "CANCELLED") {
          const priorStop = await tx.bookingEvent.findFirst({
            where: { parcelBookingId: booking.id, eventType: "INTEGRATION_SHIPMENT_STOPPED" },
            orderBy: { createdAt: "desc" },
            select: { id: true, createdAt: true },
          });
          if (!priorStop) {
            throw new ConflictError("The shipment is already cancelled outside this integration stop command.", "INTEGRATION_SHIPMENT_ALREADY_CANCELLED");
          }
          const responseBody = { shipmentId: booking.id, externalFulfillmentReference, status: "STOPPED", stoppedAt: priorStop.createdAt, alreadyStopped: true };
          await storeIdempotency(tx, { clientId: client.id, operation, key: idempotencyKey, payloadHash, responseStatus: 200, responseBody, now });
          return { statusCode: 200, body: responseBody, replay: false };
        }
        if (["COMPLETED", "FAILED"].includes(booking.status)) {
          throw new ConflictError("A terminal shipment cannot be stopped or returned.", "INTEGRATION_SHIPMENT_TERMINAL");
        }
        if (["PICKED_UP", "IN_TRANSIT", "DELIVERY_VERIFICATION_PENDING"].includes(booking.status)) {
          throw new ConflictError("The parcel has progressed beyond the safe stop window. Submit a return request instead.", "INTEGRATION_SHIPMENT_STOP_WINDOW_CLOSED");
        }
        if (!["AWAITING_PARTNER_ASSIGNMENT", "DRIVER_ASSIGNED"].includes(booking.status)) {
          throw new ConflictError("The shipment is not in a supported pre-custody stop state and requires operational review.", "INTEGRATION_SHIPMENT_STOP_STATE_UNSUPPORTED");
        }

        const legIds = booking.deliveryLegs.map(leg => leg.id);
        const assignments = legIds.length ? await tx.partnerDeliveryAssignment.findMany({
          where: { deliveryLegId: { in: legIds } },
          select: { id: true, deliveryLegId: true, status: true },
        }) : [];
        const physicallyTransferred = booking.custodyHandovers.some(item => item.status === "CONFIRMED")
          || ["PICKED_UP", "IN_TRANSIT", "DELIVERY_VERIFICATION_PENDING"].includes(booking.status)
          || assignments.some(item => item.status === "IN_TRANSIT");
        if (physicallyTransferred) {
          throw new ConflictError("The parcel has entered partner or hub custody. A stop cannot be confirmed; submit a return request.", "INTEGRATION_SHIPMENT_IN_CUSTODY_USE_RETURN");
        }
        if (booking.deliveryLegs.some(leg => ["IN_TRANSIT", "DELIVERY_VERIFICATION_PENDING", "COMPLETED", "FAILED"].includes(leg.status))
          || assignments.some(item => !["ASSIGNED", "ACCEPTED", "CANCELLED"].includes(item.status))) {
          throw new ConflictError("The shipment has an unsupported or terminal execution state and requires operational review.", "INTEGRATION_SHIPMENT_STOP_STATE_UNSUPPORTED");
        }

        if (legIds.length) {
          const expectedAssignmentCount = assignments.filter(item => ["ASSIGNED", "ACCEPTED"].includes(item.status)).length;
          const assignmentsChanged = await tx.partnerDeliveryAssignment.updateMany({
            where: { deliveryLegId: { in: legIds }, status: { in: ["ASSIGNED", "ACCEPTED"] } },
            data: { status: "CANCELLED", cancelledAt: now, failureReason: "Integration shipment stopped before custody transfer." },
          });
          if (assignmentsChanged.count !== expectedAssignmentCount) {
            throw new ConflictError("A partner assignment changed while the stop command was being processed. Retry after refreshing shipment state.", "INTEGRATION_SHIPMENT_STOP_ASSIGNMENT_CONFLICT");
          }
          const expectedPendingHandoverCount = booking.custodyHandovers.filter(item => item.status === "PENDING_CONFIRMATION").length;
          const handoversChanged = await tx.custodyHandover.updateMany({
            where: { parcelBookingId: booking.id, status: "PENDING_CONFIRMATION" },
            data: { status: "CANCELLED" },
          });
          if (handoversChanged.count !== expectedPendingHandoverCount) {
            throw new ConflictError("A custody handover changed while the stop command was being processed. Retry after refreshing shipment state.", "INTEGRATION_SHIPMENT_STOP_CUSTODY_CONFLICT");
          }
          const cancellableLegCount = booking.deliveryLegs.filter(leg => ["PLANNED", "READY_FOR_ASSIGNMENT", "ASSIGNED"].includes(leg.status)).length;
          const legsChanged = await tx.deliveryLeg.updateMany({
            where: { parcelBookingId: booking.id, status: { in: ["PLANNED", "READY_FOR_ASSIGNMENT", "ASSIGNED"] } },
            data: { status: "CANCELLED", cancelledAt: now, failureReason: "Integration shipment stopped before custody transfer." },
          });
          if (legsChanged.count !== cancellableLegCount) {
            throw new ConflictError("A delivery leg changed while the stop command was being processed. Retry after refreshing shipment state.", "INTEGRATION_SHIPMENT_STOP_LEG_CONFLICT");
          }
        }

        const changed = await tx.parcelBooking.updateMany({
          where: {
            id: booking.id, integrationClientId: client.id,
            status: { in: ["AWAITING_PARTNER_ASSIGNMENT", "DRIVER_ASSIGNED"] },
          },
          data: { status: "CANCELLED", cancelledAt: now, cancellationReason: reason },
        });
        if (changed.count !== 1) {
          throw new ConflictError("The shipment changed while the stop command was being processed.", "INTEGRATION_SHIPMENT_STOP_CONFLICT");
        }

        const sourceEvent = await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            eventType: "INTEGRATION_SHIPMENT_STOPPED",
            fromStatus: booking.status,
            toStatus: "CANCELLED",
            metadata: {
              integrationClientId: client.id,
              externalFulfillmentReference,
              reason,
              stoppedAt: now.toISOString(),
              cancelledLegIds: legIds,
            },
          },
        });
        await projectIntegrationShipmentEvent({ tx, parcelBookingId: booking.id, sourceEvent });
        const responseBody = { shipmentId: booking.id, externalFulfillmentReference, status: "STOPPED", stoppedAt: now };
        await storeIdempotency(tx, { clientId: client.id, operation, key: idempotencyKey, payloadHash, responseStatus: 200, responseBody, now });
        return { statusCode: 200, body: responseBody, replay: false };
      });
    },

    async requestShipmentReturn({ client, idempotencyKey, externalFulfillmentReference, reason }) {
      const now = clock();
      const operation = "integration.shipment.return-request";
      const input = { externalFulfillmentReference, reason };
      const payloadHash = hashPayload(input);
      return serializableTransaction(prismaClient, async tx => {
        const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
        if (replay) return { ...replay, replay: true };

        const external = await tx.integrationExternalReference.findFirst({
          where: { clientId: client.id, resourceType: "SHIPMENT", externalReference: externalFulfillmentReference },
          select: { internalResourceId: true },
        });
        if (!external) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");

        const booking = await tx.parcelBooking.findFirst({
          where: { id: external.internalResourceId, integrationClientId: client.id },
          include: {
            deliveryLegs: { select: { id: true, status: true } },
            custodyHandovers: { where: { status: "CONFIRMED" }, orderBy: { confirmedAt: "desc" }, select: { id: true, fromPartyType: true, toPartyType: true, fromPartyId: true, toPartyId: true, confirmedAt: true } },
          },
        });
        if (!booking) throw new NotFoundError("Integration shipment not found.", "INTEGRATION_SHIPMENT_NOT_FOUND");
        if (booking.paymentStatus !== "SUCCEEDED" || !booking.deliveryLegs.length) {
          throw new ConflictError("The integration shipment is missing its paid booking or delivery-leg prerequisites for a return request.", "INTEGRATION_SHIPMENT_RETURN_PREREQUISITES_MISSING");
        }
        if (["COMPLETED", "CANCELLED", "FAILED"].includes(booking.status)) {
          throw new ConflictError("A return cannot be requested for a terminal shipment.", "INTEGRATION_SHIPMENT_NOT_RETURNABLE");
        }
        const legIds = booking.deliveryLegs.map(leg => leg.id);
        const assignments = await tx.partnerDeliveryAssignment.findMany({
          where: { deliveryLegId: { in: legIds } },
          select: { id: true, deliveryLegId: true, status: true },
        });
        const physicallyTransferred = ["PICKED_UP", "IN_TRANSIT", "DELIVERY_VERIFICATION_PENDING"].includes(booking.status)
          || booking.custodyHandovers.length > 0
          || assignments.some(item => item.status === "IN_TRANSIT");
        if (!physicallyTransferred) {
          throw new ConflictError("The parcel has not entered confirmed custody. Use the stop command while the shipment is still stoppable.", "INTEGRATION_SHIPMENT_NOT_IN_RETURN_WINDOW");
        }

        const stateGuard = await tx.parcelBooking.updateMany({
          where: {
            id: booking.id,
            integrationClientId: client.id,
            paymentStatus: "SUCCEEDED",
            status: booking.status,
          },
          data: { updatedAt: now },
        });
        if (stateGuard.count !== 1) {
          throw new ConflictError("The shipment changed while the return request was being recorded. Retry after refreshing shipment state.", "INTEGRATION_RETURN_REQUEST_CONFLICT");
        }

        const existingRequest = await tx.bookingEvent.findFirst({
          where: { parcelBookingId: booking.id, eventType: "INTEGRATION_RETURN_REQUESTED" },
          orderBy: { createdAt: "desc" },
          select: { id: true, createdAt: true, metadata: true },
        });
        if (existingRequest) {
          const responseBody = {
            shipmentId: booking.id,
            externalFulfillmentReference,
            status: "RETURN_REQUESTED",
            shipmentStatus: booking.status,
            requestedAt: existingRequest.createdAt,
            physicalReturnConfirmed: false,
            alreadyRequested: true,
          };
          await storeIdempotency(tx, { clientId: client.id, operation, key: idempotencyKey, payloadHash, responseStatus: 202, responseBody, now });
          return { statusCode: 202, body: responseBody, replay: false };
        }

        const sourceEvent = await tx.bookingEvent.create({
          data: {
            parcelBookingId: booking.id,
            eventType: "INTEGRATION_RETURN_REQUESTED",
            fromStatus: booking.status,
            toStatus: booking.status,
            metadata: {
              integrationClientId: client.id,
              externalFulfillmentReference,
              reason,
              requestedAt: now.toISOString(),
              custodySnapshot: booking.custodyHandovers[0] ?? null,
              legStatuses: booking.deliveryLegs.map(leg => ({ deliveryLegId: leg.id, status: leg.status })),
              operationalActionRequired: true,
              physicalReturnConfirmed: false,
            },
          },
        });
        await projectIntegrationShipmentEvent({ tx, parcelBookingId: booking.id, sourceEvent });
        const responseBody = {
          shipmentId: booking.id,
          externalFulfillmentReference,
          status: "RETURN_REQUESTED",
          shipmentStatus: booking.status,
          requestedAt: now,
          physicalReturnConfirmed: false,
        };
        await storeIdempotency(tx, { clientId: client.id, operation, key: idempotencyKey, payloadHash, responseStatus: 202, responseBody, now });
        return { statusCode: 202, body: responseBody, replay: false };
      });
    },

    async createShipment({ client, idempotencyKey, input }) {
      const now = clock();
      const payloadHash = hashPayload(input);
      const operation = "integration.shipment.create";
      try {
        return await serializableTransaction(prismaClient, async tx => {
          const replay = await replayOrConflict(tx, client.id, operation, idempotencyKey, payloadHash);
          if (replay) return replay;

          const existingShipment = await tx.integrationExternalReference.findFirst({
            where: {
              clientId: client.id,
              resourceType: "SHIPMENT",
              externalReference: input.externalFulfillmentReference,
            },
          });
          if (existingShipment) {
            throw new ConflictError("This external fulfilment reference already has a shipment. Use the original idempotency key for replay.", "INTEGRATION_SHIPMENT_ALREADY_CREATED");
          }

          const { session, option, billingAgreement, packageRates, ratesById } = await revalidateSelectedQuote(tx, {
            clientId: client.id,
            quoteSessionId: input.quoteSessionId,
            quoteOptionId: input.quoteOptionId,
            externalFulfillmentReference: input.externalFulfillmentReference,
            now,
          });

          const attestation = input.paymentAttestation;
          const verifiedAt = new Date(attestation.verifiedAt);
          if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt > now || verifiedAt < session.createdAt) {
            throw new ConflictError("The external payment verification timestamp is invalid for this quote.", "INTEGRATION_PAYMENT_ATTESTATION_INVALID");
          }
          if (attestation.currency !== option.currency
            || BigInt(attestation.deliveryChargeMinor) !== option.customerChargeMinor) {
            throw new ConflictError("The attested delivery charge and currency must exactly match the selected quote option.", "INTEGRATION_PAYMENT_AMOUNT_MISMATCH");
          }
          const orderPaymentAmountMinor = attestation.orderPaymentAmountMinor == null
            ? null : BigInt(attestation.orderPaymentAmountMinor);

          const bookingPackages = session.packages.map(pkg => ({
            externalPackageRef: pkg.externalPackageRef,
            packageSequence: pkg.packageSequence,
            packageCategory: pkg.packageCategory,
            description: pkg.description,
            weightGrams: pkg.weightGrams,
            lengthMm: pkg.lengthMm,
            widthMm: pkg.widthMm,
            heightMm: pkg.heightMm,
            declaredValueMinor: pkg.declaredValueMinor,
            assessmentStatus: pkg.assessmentStatus,
            assessmentSource: pkg.assessmentSource,
            assessmentConfidence: pkg.assessmentConfidence,
            assessedAt: pkg.assessedAt,
          }));

          const booking = await tx.parcelBooking.create({
            data: {
              publicReference: publicReference(),
              senderId: null,
              integrationClientId: client.id,
              pickupServiceZoneId: session.pickupServiceZoneId,
              destinationServiceZoneId: session.destinationServiceZoneId,
              status: "AWAITING_PARTNER_ASSIGNMENT",
              paymentStatus: "SUCCEEDED",
              currency: option.currency,
              pickupAddress: session.pickupAddress,
              pickupLatitude: session.pickupLatitude,
              pickupLongitude: session.pickupLongitude,
              destinationAddress: session.destinationAddress,
              destinationLatitude: session.destinationLatitude,
              destinationLongitude: session.destinationLongitude,
              recipientName: session.recipientName,
              recipientPhone: session.recipientPhone,
              parcelCategory: null,
              parcelDescription: null,
              parcelSize: null,
              declaredValueMinor: null,
              driverFareMinor: option.routeMode === "LOCAL_DIRECT" ? option.driverPayoutMinor : null,
              connectionFeeMinor: option.platformChargeMinor,
              otherChargesMinor: option.otherChargesMinor,
              customerPayableMinor: option.customerChargeMinor,
              pricingRuleId: null,
              pricingSnapshot: {
                source: "INTEGRATION_QUOTE",
                quoteSessionId: session.id,
                quoteOptionId: option.id,
                billingAgreementReference: billingAgreement.reference,
                billingAgreementVersion: billingAgreement.version,
                billingModel: billingAgreement.billingModel,
                currency: option.currency,
                logisticsCostMinor: option.logisticsCostMinor.toString(),
                platformChargeMinor: option.platformChargeMinor.toString(),
                otherChargesMinor: option.otherChargesMinor.toString(),
                customerChargeMinor: option.customerChargeMinor.toString(),
                driverPayoutMinor: option.driverPayoutMinor?.toString() ?? null,
                paymentCollection: "EXTERNAL_PLATFORM",
                routeSnapshot: option.routeSnapshot,
                packageRateSnapshot: option.packageRateSnapshot,
              },
              paidAt: now,
              parcelPackages: { create: bookingPackages },
            },
            include: { parcelPackages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
          });

          const rateIds = [...new Set(packageRates.map(item => item.rateId))];
          const quote = await tx.shipmentQuote.create({
            data: {
              parcelBookingId: booking.id,
              version: 1,
              status: "ACCEPTED",
              partnerAgreementId: option.partnerAgreementId,
              partnerRateId: option.routeMode === "END_TO_END" && rateIds.length === 1 ? rateIds[0] : null,
              currency: option.currency,
              transportChargeMinor: option.logisticsCostMinor,
              platformChargeMinor: option.platformChargeMinor,
              otherChargesMinor: option.otherChargesMinor,
              totalCustomerChargeMinor: option.customerChargeMinor,
              chargeBreakdown: {
                transportChargeMinor: option.logisticsCostMinor.toString(),
                platformChargeMinor: option.platformChargeMinor.toString(),
                otherChargesMinor: option.otherChargesMinor.toString(),
                totalCustomerChargeMinor: option.customerChargeMinor.toString(),
                currency: option.currency,
                collectionModel: "PLATFORM_COLLECTED",
              },
              inputSnapshot: {
                source: "INTEGRATION_QUOTE",
                quoteSessionId: session.id,
                quoteOptionId: option.id,
                externalFulfillmentReference: session.externalReference,
                billingAgreementReference: billingAgreement.reference,
                billingAgreementVersion: billingAgreement.version,
                billingModel: billingAgreement.billingModel,
                routeSnapshot: option.routeSnapshot,
                packageRateSnapshot: option.packageRateSnapshot,
                driverPayoutMinor: option.driverPayoutMinor?.toString() ?? null,
                packages: session.packages.map(pkg => ({
                  externalPackageRef: pkg.externalPackageRef,
                  packageCategory: pkg.packageCategory,
                  weightGrams: pkg.weightGrams,
                  lengthMm: pkg.lengthMm,
                  widthMm: pkg.widthMm,
                  heightMm: pkg.heightMm,
                  declaredValueMinor: pkg.declaredValueMinor?.toString() ?? null,
                  assessmentStatus: pkg.assessmentStatus,
                  assessmentSource: pkg.assessmentSource,
                })),
              },
              expiresAt: option.expiresAt,
              acceptedAt: now,
              acceptedByUserId: null,
            },
          });

          const plan = await createMultiLegPlan({
            tx,
            booking: { ...booking, packages: booking.parcelPackages },
            quote,
            now,
          });
          const validEndToEndPlan = plan.routeMode === "END_TO_END" && plan.legs.length === 1
            && plan.legs[0].type === "INTERSTATE_TRANSPORT"
            && plan.legs[0].status === "READY_FOR_ASSIGNMENT";
          const validLocalDirectPlan = plan.routeMode === "LOCAL_DIRECT" && plan.legs.length === 1
            && plan.legs[0].type === "LOCAL_PICKUP"
            && plan.legs[0].status === "READY_FOR_ASSIGNMENT";
          if (!validEndToEndPlan && !validLocalDirectPlan) {
            throw new ConflictError("The operational delivery plan does not match the accepted quote topology.", "INTEGRATION_ROUTE_PLAN_MISMATCH");
          }

          await tx.integrationPaymentAttestation.create({
            data: {
              clientId: client.id,
              quoteSessionId: session.id,
              quoteOptionId: option.id,
              parcelBookingId: booking.id,
              paymentProvider: attestation.paymentProvider.toUpperCase(),
              externalPaymentReference: attestation.externalPaymentReference,
              verifiedAt,
              attestedAt: now,
              deliveryChargeMinor: BigInt(attestation.deliveryChargeMinor),
              currency: attestation.currency,
              orderPaymentAmountMinor,
            },
          });
          await tx.integrationExternalReference.create({
            data: {
              clientId: client.id,
              resourceType: "SHIPMENT",
              externalReference: input.externalFulfillmentReference,
              internalResourceType: "ParcelBooking",
              internalResourceId: booking.id,
            },
          });

          const changed = await tx.integrationQuoteSession.updateMany({
            where: {
              id: session.id,
              clientId: client.id,
              status: "SELECTED",
              selectedOptionId: option.id,
              expiresAt: { gt: now },
            },
            data: { status: "BOOKED" },
          });
          if (changed.count !== 1) {
            throw new ConflictError("The selected quote changed while shipment creation was processing.", "INTEGRATION_QUOTE_NOT_BOOKABLE");
          }

          const sourceEvent = await tx.bookingEvent.create({
            data: {
              parcelBookingId: booking.id,
              eventType: "INTEGRATION_SHIPMENT_CREATED",
              fromStatus: null,
              toStatus: "AWAITING_PARTNER_ASSIGNMENT",
              metadata: {
                integrationClientId: client.id,
                quoteSessionId: session.id,
                quoteOptionId: option.id,
                externalFulfillmentReference: input.externalFulfillmentReference,
                externalPaymentProvider: attestation.paymentProvider.toUpperCase(),
                externalPaymentReference: attestation.externalPaymentReference,
                externalPaymentVerifiedAt: verifiedAt.toISOString(),
                deliveryChargeMinor: option.customerChargeMinor.toString(),
                currency: option.currency,
                deliveryLegIds: plan.legs.map(leg => leg.id),
              },
            },
          });
          await projectIntegrationShipmentEvent({ tx, parcelBookingId: booking.id, sourceEvent });

          const responseBody = {
            shipment: {
              id: booking.id,
              reference: booking.publicReference,
              externalFulfillmentReference: input.externalFulfillmentReference,
              status: booking.status,
              paymentStatus: booking.paymentStatus,
              currency: booking.currency,
              customerChargeMinor: option.customerChargeMinor.toString(),
              routeMode: plan.routeMode,
              deliveryLegs: plan.legs.map(leg => ({
                id: leg.id, sequence: leg.sequence, type: leg.type, status: leg.status,
              })),
              packages: booking.parcelPackages.map(pkg => ({
                externalPackageRef: pkg.externalPackageRef,
                packageCategory: pkg.packageCategory,
                weightGrams: pkg.weightGrams,
                lengthMm: pkg.lengthMm,
                widthMm: pkg.widthMm,
                heightMm: pkg.heightMm,
              })),
            },
            paymentAttestation: {
              paymentProvider: attestation.paymentProvider.toUpperCase(),
              externalPaymentReference: attestation.externalPaymentReference,
              verifiedAt,
              deliveryChargeMinor: option.customerChargeMinor.toString(),
              currency: option.currency,
            },
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
            if (existing.payloadHash !== payloadHash) {
              throw new ConflictError("The Idempotency-Key was reused with a different request payload.", "IDEMPOTENCY_CONFLICT");
            }
            if (existing.responseBody) {
              return { statusCode: existing.responseStatus ?? 201, body: existing.responseBody, replay: true };
            }
          }
          const duplicatePayment = await prismaClient.integrationPaymentAttestation.findFirst({
            where: {
              clientId: client.id,
              paymentProvider: input.paymentAttestation.paymentProvider.toUpperCase(),
              externalPaymentReference: input.paymentAttestation.externalPaymentReference,
            },
            select: { id: true },
          });
          if (duplicatePayment) {
            throw new ConflictError("This external payment reference has already been attested for another shipment.", "INTEGRATION_PAYMENT_REFERENCE_REUSED");
          }
          const duplicateShipment = await prismaClient.integrationExternalReference.findFirst({
            where: {
              clientId: client.id,
              resourceType: "SHIPMENT",
              externalReference: input.externalFulfillmentReference,
            },
            select: { id: true },
          });
          if (duplicateShipment) {
            throw new ConflictError("This external fulfilment reference already has a shipment. Use the original idempotency key for replay.", "INTEGRATION_SHIPMENT_ALREADY_CREATED");
          }
        }
        throw error;
      }
    },
  };
}
