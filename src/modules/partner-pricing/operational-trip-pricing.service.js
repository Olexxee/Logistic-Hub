import { resolveDeliveryRoute } from "../delivery-legs/delivery-route-planner.js";
import { customerQuoteView } from "../parcels/customer-shipment-quotes.service.js";

function routeSnapshot(route) {
  const sourceLegs = route.routeMode === "LOCAL_DIRECT" ? [{
    sequence: 1, type: "LOCAL_PICKUP",
    originServiceZoneId: route.origin.serviceZoneId,
    destinationServiceZoneId: route.destination.serviceZoneId,
    originHubPointId: null, destinationHubPointId: null,
    originLatitude: route.origin.latitude, originLongitude: route.origin.longitude,
    destinationLatitude: route.destination.latitude, destinationLongitude: route.destination.longitude,
  }] : route.legs;
  return {
    routeMode: route.routeMode, origin: route.origin, destination: route.destination,
    originHub: route.originHub, destinationHub: route.destination, routePlanVersion: 1,
    legs: sourceLegs.map(leg => ({
      sequence: leg.sequence, type: leg.type,
      originServiceZoneId: leg.originServiceZoneId, destinationServiceZoneId: leg.destinationServiceZoneId,
      originHubPointId: leg.originHubPointId ?? null, destinationHubPointId: leg.destinationHubPointId ?? null,
      origin: { latitude: Number(leg.originLatitude), longitude: Number(leg.originLongitude) },
      destination: { latitude: Number(leg.destinationLatitude), longitude: Number(leg.destinationLongitude) },
    })),
  };
}
function packageSnapshot(booking) {
  return (booking.parcelPackages ?? []).map(pkg => ({
    id: pkg.id, packageCategory: pkg.packageCategory, weightGrams: pkg.weightGrams,
    lengthMm: pkg.lengthMm, widthMm: pkg.widthMm, heightMm: pkg.heightMm,
  }));
}
function samePackages(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((pkg, index) => pkg.id === right[index].id
      && pkg.packageCategory === right[index].packageCategory
      && pkg.weightGrams === right[index].weightGrams
      && pkg.lengthMm === right[index].lengthMm
      && pkg.widthMm === right[index].widthMm
      && pkg.heightMm === right[index].heightMm);
}
function sameRoute(a, b) {
  return a.routeMode === b.routeMode && a.originHub?.id === b.originHub?.id
    && a.destinationHub?.id === b.destinationHub?.id && a.legs.length === b.legs.length
    && a.legs.every((leg, i) => leg.sequence === b.legs[i].sequence && leg.type === b.legs[i].type
      && leg.originServiceZoneId === b.legs[i].originServiceZoneId
      && leg.destinationServiceZoneId === b.legs[i].destinationServiceZoneId
      && leg.originHubPointId === b.legs[i].originHubPointId
      && leg.destinationHubPointId === b.legs[i].destinationHubPointId);
}
const sum = values => values.reduce((total, value) => total + BigInt(value), 0n);
async function activeZones(tx, booking, now) {
  const ids = [...new Set([booking.pickupServiceZoneId, booking.destinationServiceZoneId])];
  const found = await tx.serviceZone.findMany({ where: {
    id: { in: ids }, isActive: true, state: { isActive: true, country: { isActive: true } },
    availability: { some: { serviceType: "PARCEL_DELIVERY", isEnabled: true, AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ] } },
  }, select: { id: true } });
  return found.length === ids.length;
}
async function resolve(tx, booking) {
  const packages = (booking.parcelPackages ?? []).map(pkg => ({
    id: pkg.id, packageCategory: pkg.packageCategory, weightGrams: pkg.weightGrams,
    lengthMm: pkg.lengthMm, widthMm: pkg.widthMm, heightMm: pkg.heightMm,
  }));
  return resolveDeliveryRoute({ tx, booking: { ...booking, packages } });
}
async function partnersValid(tx, legs, currency, now) {
  for (const leg of legs.filter(item => item.executionType === "PARTNER")) {
    const agreement = await tx.partnerAgreement.findFirst({ where: {
      id: leg.agreementId, partnerId: leg.partnerId, status: "ACTIVE", currency,
      effectiveFrom: { lte: now },
      AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      partner: { status: "ACTIVE", verificationStatus: "VERIFIED" },
    }, select: { id: true } });
    if (!agreement) return false;
  }
  return true;
}
async function hubsValid(tx, route) {
  if (route.routeMode !== "HUB_ASSISTED") return true;
  const ids = [route.originHub?.id, route.destinationHub?.id].filter(Boolean);
  const hubs = await tx.hubPoint.findMany({ where: { id: { in: ids }, status: "ACTIVE", operatorVerificationStatus: "VERIFIED" }, select: { id: true } });
  return hubs.length === new Set(ids).size;
}
async function serializable(client, work) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await client.$transaction(work, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}

function adminQuoteView(quote) {
  return {
    ...customerQuoteView(quote),
    reason: quote.inputSnapshot?.reason ?? null,
    operationalPlan: (quote.inputSnapshot?.operationalLegs ?? []).map(leg => ({
      sequence: leg.sequence, type: leg.type, executionType: leg.executionType,
      customerChargeMinor: leg.customerChargeMinor,
      ...(leg.executionType === "PLATFORM_MANAGED_DRIVER" ? {
        payeeName: leg.payeeName, payeePhone: leg.payeePhone ?? null, driverPayoutMinor: leg.driverPayoutMinor,
      } : { partnerId: leg.partnerId, agreementId: leg.agreementId, executionCostMinor: leg.executionCostMinor }),
    })),
  };
}

export async function validateOperationalTripQuote(tx, booking, quote, now = new Date()) {
  const snapshot = quote.inputSnapshot ?? {};
  if (snapshot.source !== "ADMIN_OPERATIONAL_TRIP" || !Array.isArray(snapshot.operationalLegs)) return false;
  if (!await activeZones(tx, booking, now)) return false;
  const route = await resolve(tx, booking);
  const current = routeSnapshot(route);
  if (!sameRoute(snapshot.routeSnapshot, current) || snapshot.operationalLegs.length !== current.legs.length
    || !samePackages(snapshot.packageSnapshot, packageSnapshot(booking))) return false;
  if (!snapshot.operationalLegs.every((leg, i) => leg.sequence === current.legs[i].sequence && leg.type === current.legs[i].type
    && (leg.executionType !== "PLATFORM_MANAGED_DRIVER" || (leg.payeeName && leg.driverPayoutMinor && BigInt(leg.driverPayoutMinor) > 0n)))) return false;
  if (!await partnersValid(tx, snapshot.operationalLegs, quote.currency, now)) return false;
  return hubsValid(tx, route);
}

export function createOperationalTripPricingService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    async getPlan({ bookingId }) {
      const now = clock();
      return serializable(prismaClient, async tx => {
        const booking = await tx.parcelBooking.findUnique({ where: { id: bookingId }, include: { parcelPackages: { orderBy: { packageSequence: "asc" } } } });
        if (!booking) return { notFound: true };
        if (booking.status !== "DRAFT") return { conflict: "Operational pricing can only be prepared for a draft booking." };
        if (!await activeZones(tx, booking, now)) return { unavailable: true };
        const route = await resolve(tx, booking);
        if (!await hubsValid(tx, route)) return { unavailable: true };
        return { booking: { id: booking.id, publicReference: booking.publicReference, currency: booking.currency },
          route: routeSnapshot(route), packageCount: booking.parcelPackages.length };
      });
    },
    async issueQuote({ bookingId, actorUserId, input }) {
      const now = clock(), expiresAt = new Date(now.getTime() + input.expiresInMinutes * 60_000);
      return serializable(prismaClient, async tx => {
        const booking = await tx.parcelBooking.findUnique({ where: { id: bookingId }, include: { parcelPackages: { orderBy: { packageSequence: "asc" } } } });
        if (!booking) return { notFound: true };
        if (booking.status !== "DRAFT") return { conflict: "Operational quotes can only be issued for draft bookings." };
        if (!await activeZones(tx, booking, now)) return { unavailable: true };
        const route = await resolve(tx, booking), snapshot = routeSnapshot(route);
        if (!await hubsValid(tx, route)) return { hubIneligible: true };
        if (input.legs.length !== snapshot.legs.length) return { routeChanged: true };
        const legs = [];
        for (let i = 0; i < snapshot.legs.length; i += 1) {
          const routeLeg = snapshot.legs[i], supplied = input.legs[i];
          if (supplied.sequence !== routeLeg.sequence || supplied.type !== routeLeg.type) return { routeChanged: true };
          if (BigInt(supplied.customerChargeMinor) <= 0n) return { invalidExecution: true };
          if (supplied.executionType === "PLATFORM_MANAGED_DRIVER") {
            if (!supplied.payeeName
              || !supplied.driverPayoutMinor || BigInt(supplied.driverPayoutMinor) <= 0n
              || supplied.partnerId || supplied.agreementId || supplied.executionCostMinor !== undefined) return { invalidExecution: true };
          } else if (!supplied.partnerId || !supplied.agreementId || !supplied.executionCostMinor || BigInt(supplied.executionCostMinor) <= 0n
            || supplied.driverPayoutMinor !== undefined || supplied.payeeName !== undefined || supplied.payeePhone !== undefined) return { invalidExecution: true };
          legs.push({ ...routeLeg, executionType: supplied.executionType, customerChargeMinor: supplied.customerChargeMinor,
            ...(supplied.executionType === "PLATFORM_MANAGED_DRIVER" ? {
              payeeName: supplied.payeeName, ...(supplied.payeePhone ? { payeePhone: supplied.payeePhone } : {}),
              driverPayoutMinor: supplied.driverPayoutMinor,
            } : { partnerId: supplied.partnerId, agreementId: supplied.agreementId, executionCostMinor: supplied.executionCostMinor }) });
        }
        if (!await partnersValid(tx, legs, booking.currency, now)) return { partnerIneligible: true };
        const lock = await tx.parcelBooking.updateMany({ where: { id: booking.id, status: "DRAFT" }, data: { updatedAt: now } });
        if (lock.count !== 1) return { conflict: "The booking changed while the operational quote was being prepared." };
        const previous = await tx.shipmentQuote.findFirst({ where: { parcelBookingId: booking.id }, orderBy: { version: "desc" }, select: { version: true } });
        await tx.shipmentQuote.updateMany({ where: { parcelBookingId: booking.id, status: "OFFERED" }, data: { status: "SUPERSEDED" } });
        const transport = sum(legs.map(leg => leg.customerChargeMinor));
        const collection = BigInt(input.collectionChargeMinor), handling = BigInt(input.hubHandlingChargeMinor);
        const destination = BigInt(input.destinationDeliveryChargeMinor), platform = BigInt(input.platformChargeMinor);
        const other = BigInt(input.otherChargesMinor), total = transport + collection + handling + destination + platform + other;
        const internalExecutionCost = sum(legs.map(leg => leg.executionType === "PLATFORM_MANAGED_DRIVER" ? leg.driverPayoutMinor : leg.executionCostMinor));
        if (total <= 0n || total > 999999999999999n || internalExecutionCost > total) return { invalidTotal: true };
        const quote = await tx.shipmentQuote.create({ data: {
          parcelBookingId: booking.id, version: (previous?.version ?? 0) + 1, status: "OFFERED", currency: booking.currency,
          transportChargeMinor: transport, collectionChargeMinor: collection, hubHandlingChargeMinor: handling,
          destinationDeliveryChargeMinor: destination, platformChargeMinor: platform, otherChargesMinor: other,
          totalCustomerChargeMinor: total,
          chargeBreakdown: {
            transportChargeMinor: transport.toString(), collectionChargeMinor: collection.toString(),
            hubHandlingChargeMinor: handling.toString(), destinationDeliveryChargeMinor: destination.toString(),
            platformChargeMinor: platform.toString(), otherChargesMinor: other.toString(),
            legs: legs.map(leg => ({ sequence: leg.sequence, type: leg.type, customerChargeMinor: leg.customerChargeMinor })),
          },
          inputSnapshot: { source: "ADMIN_OPERATIONAL_TRIP", routeSnapshot: snapshot, packageSnapshot: packageSnapshot(booking), operationalLegs: legs, reason: input.reason },
          expiresAt,
        } });
        await tx.bookingEvent.create({ data: { parcelBookingId: booking.id, actorUserId,
          eventType: "ADMIN_OPERATIONAL_TRIP_QUOTE_ISSUED", fromStatus: "DRAFT", toStatus: "DRAFT",
          metadata: { quoteId: quote.id, quoteVersion: quote.version, totalCustomerChargeMinor: total.toString(), currency: quote.currency } } });
        await tx.operationalAuditEvent.create({ data: {
          actorUserId, entityType: "SHIPMENT_QUOTE", entityId: quote.id,
          action: "ADMIN_OPERATIONAL_TRIP_QUOTE_ISSUED", reason: input.reason,
          after: {
            parcelBookingId: booking.id, quoteVersion: quote.version, source: "ADMIN_OPERATIONAL_TRIP",
            totalCustomerChargeMinor: total.toString(), currency: quote.currency,
            operationalLegs: legs.map(leg => ({
              sequence: leg.sequence, type: leg.type, executionType: leg.executionType,
              ...(leg.partnerId ? { partnerId: leg.partnerId, agreementId: leg.agreementId, executionCostMinor: leg.executionCostMinor } : {}),
              ...(leg.driverPayoutMinor ? { driverPayoutMinor: leg.driverPayoutMinor, payeeName: leg.payeeName, payeePhone: leg.payeePhone ?? null } : {}),
            })),
          },
        } });
        return { quote: adminQuoteView(quote) };
      });
    },
    async listQuotes({ bookingId }) {
      const booking = await prismaClient.parcelBooking.findUnique({ where: { id: bookingId }, select: { id: true } });
      if (!booking) return { notFound: true };
      const quotes = await prismaClient.shipmentQuote.findMany({ where: {
        parcelBookingId: bookingId, inputSnapshot: { path: ["source"], equals: "ADMIN_OPERATIONAL_TRIP" },
      }, orderBy: { version: "desc" } });
      return { items: quotes.map(adminQuoteView) };
    },
  };
}
