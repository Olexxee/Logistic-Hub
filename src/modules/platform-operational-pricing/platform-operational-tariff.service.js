import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";
import { ConflictError, NotFoundError } from "../../shared/http/app-error.js";

const effective = (record, at) => Boolean(record?.isEnabled
  && (!record.startsAt || record.startsAt <= at)
  && (!record.endsAt || record.endsAt > at));

const view = row => ({
  ...row,
  customerChargeMinor: row.customerChargeMinor.toString(),
  platformChargeMinor: row.platformChargeMinor.toString(),
});

const locator = input => ({
  scope: input.scope,
  serviceType: input.serviceType ?? "PARCEL_DELIVERY",
  legType: input.legType ?? null,
  operationType: input.operationType ?? null,
  serviceZoneId: input.serviceZoneId ?? null,
  originHubPointId: input.originHubPointId ?? null,
  destinationHubPointId: input.destinationHubPointId ?? null,
  hubPointId: input.hubPointId ?? null,
});

const locatorWhere = input => Object.fromEntries(
  Object.entries(locator(input)).filter(([key]) => key !== "scope").map(([key, value]) => [key, value]),
);

async function assertLocatorExists(tx, input) {
  if (input.scope === "LOCAL_ZONE") {
    const zone = await tx.serviceZone.findUnique({ where: { id: input.serviceZoneId }, select: { id: true } });
    if (!zone) throw new NotFoundError("Service zone not found.", "SERVICE_ZONE_NOT_FOUND");
    return;
  }
  const ids = input.scope === "HUB_PAIR"
    ? [input.originHubPointId, input.destinationHubPointId]
    : [input.hubPointId];
  const hubs = await tx.hubPoint.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (hubs.length !== ids.length) throw new NotFoundError("One or more hub points were not found.", "HUB_POINT_NOT_FOUND");
}

async function assertLocatorServiceable(tx, input) {
  if (input.scope === "LOCAL_ZONE") {
    const zone = await tx.serviceZone.findUnique({
      where: { id: input.serviceZoneId },
      include: { state: { include: { country: true } }, availability: { where: { serviceType: input.serviceType } } },
    });
    if (!zone) throw new NotFoundError("Service zone not found.", "SERVICE_ZONE_NOT_FOUND");
    if (!zone.isActive || !zone.state?.isActive || !zone.state?.country?.isActive
      || !effective(zone.availability?.[0], new Date())) {
      throw new ConflictError("The service zone and parcel-delivery availability must be active before enabling this scope.", "OPERATIONAL_TARIFF_LOCATION_UNAVAILABLE");
    }
    return;
  }

  const ids = input.scope === "HUB_PAIR"
    ? [input.originHubPointId, input.destinationHubPointId]
    : [input.hubPointId];
  const hubs = await tx.hubPoint.findMany({
    where: { id: { in: ids } },
    include: { serviceZone: { include: { state: { include: { country: true } }, availability: { where: { serviceType: input.serviceType } } } } },
  });
  if (hubs.length !== ids.length) throw new NotFoundError("One or more hub points were not found.", "HUB_POINT_NOT_FOUND");
  if (hubs.some(hub => hub.status !== "ACTIVE" || !hub.serviceZone?.isActive
    || !hub.serviceZone.state?.isActive || !hub.serviceZone.state?.country?.isActive
    || !effective(hub.serviceZone.availability?.[0], new Date()))) {
    throw new ConflictError("Every referenced hub and its service zone must be active and serviceable.", "OPERATIONAL_TARIFF_LOCATION_UNAVAILABLE");
  }
}

function scopeAvailabilityWhere(input) {
  return { scope: input.scope, ...locatorWhere(input) };
}

export function createPlatformOperationalTariffService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async list(filters = {}) {
      const rows = await prismaClient.platformOperationalTariff.findMany({
        where: {
          ...(filters.scope ? { scope: filters.scope } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.serviceZoneId ? { serviceZoneId: filters.serviceZoneId } : {}),
          ...(filters.legType ? { legType: filters.legType } : {}),
          ...(filters.originHubPointId ? { originHubPointId: filters.originHubPointId } : {}),
          ...(filters.destinationHubPointId ? { destinationHubPointId: filters.destinationHubPointId } : {}),
          ...(filters.hubPointId ? { hubPointId: filters.hubPointId } : {}),
          ...(filters.operationType ? { operationType: filters.operationType } : {}),
          ...(filters.parcelCategory ? { parcelCategory: filters.parcelCategory } : {}),
        },
        include: {
          serviceZone: { select: { id: true, code: true, name: true } },
          originHub: { select: { id: true, name: true, status: true } },
          destinationHub: { select: { id: true, name: true, status: true } },
          hubPoint: { select: { id: true, name: true, status: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
      return rows.map(view);
    },

    async listAvailability(filters = {}) {
      const rows = await prismaClient.platformOperationalTariffAvailability.findMany({
        where: {
          ...(filters.scope ? { scope: filters.scope } : {}),
          ...(filters.serviceZoneId ? { serviceZoneId: filters.serviceZoneId } : {}),
          ...(filters.legType ? { legType: filters.legType } : {}),
          ...(filters.originHubPointId ? { originHubPointId: filters.originHubPointId } : {}),
          ...(filters.destinationHubPointId ? { destinationHubPointId: filters.destinationHubPointId } : {}),
          ...(filters.hubPointId ? { hubPointId: filters.hubPointId } : {}),
          ...(filters.operationType ? { operationType: filters.operationType } : {}),
          ...(filters.serviceType ? { serviceType: filters.serviceType } : {}),
        },
        include: {
          serviceZone: { select: { id: true, code: true, name: true } },
          originHub: { select: { id: true, name: true, status: true } },
          destinationHub: { select: { id: true, name: true, status: true } },
          hubPoint: { select: { id: true, name: true, status: true } },
        },
        orderBy: [{ scope: "asc" }, { createdAt: "desc" }],
      });
      return rows;
    },

    async create(input, actorUserId) {
      const { reason, ...data } = input;
      return prismaClient.$transaction(async tx => {
        await assertLocatorExists(tx, data);
        const identity = {
          ...locator(data),
          parcelCategory: data.parcelCategory,
          currency: data.currency,
          minWeightGrams: data.minWeightGrams,
          maxWeightGrams: data.maxWeightGrams,
          maxLengthMm: data.maxLengthMm ?? null,
          maxWidthMm: data.maxWidthMm ?? null,
          maxHeightMm: data.maxHeightMm ?? null,
        };
        const last = await tx.platformOperationalTariff.findFirst({
          where: identity,
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const tariff = await tx.platformOperationalTariff.create({
          data: {
            ...locator(data),
            parcelCategory: data.parcelCategory,
            minWeightGrams: data.minWeightGrams,
            maxWeightGrams: data.maxWeightGrams,
            maxLengthMm: data.maxLengthMm ?? null,
            maxWidthMm: data.maxWidthMm ?? null,
            maxHeightMm: data.maxHeightMm ?? null,
            currency: data.currency,
            customerChargeMinor: BigInt(data.customerChargeMinor),
            platformChargeMinor: BigInt(data.platformChargeMinor),
            effectiveFrom: data.effectiveFrom,
            effectiveUntil: data.effectiveUntil ?? null,
            version: (last?.version ?? 0) + 1,
            createdByUserId: actorUserId,
          },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "PLATFORM_OPERATIONAL_TARIFF", entityId: tariff.id,
          action: "PLATFORM_OPERATIONAL_TARIFF_CREATED", reason, after: view(tariff),
        });
        return view(tariff);
      }, { isolationLevel: "Serializable" });
    },

    async publish(id, actorUserId, reason) {
      return prismaClient.$transaction(async tx => {
        const tariff = await tx.platformOperationalTariff.findUnique({ where: { id } });
        if (!tariff) throw new NotFoundError("Operational tariff not found.", "PLATFORM_OPERATIONAL_TARIFF_NOT_FOUND");
        if (tariff.status !== "DRAFT") throw new ConflictError("Only draft operational tariffs can be published.", "PLATFORM_OPERATIONAL_TARIFF_NOT_DRAFT");
        const now = clock();
        if (tariff.effectiveFrom > now || (tariff.effectiveUntil && tariff.effectiveUntil <= now)) {
          throw new ConflictError("Tariff is outside its effective window.", "PLATFORM_OPERATIONAL_TARIFF_OUTSIDE_EFFECTIVE_DATES");
        }
        await assertLocatorServiceable(tx, tariff);
        const availability = await tx.platformOperationalTariffAvailability.findFirst({
          where: scopeAvailabilityWhere(tariff),
        });
        if (!effective(availability, now)
          || (availability.startsAt && availability.startsAt > tariff.effectiveFrom)
          || (availability.endsAt && (!tariff.effectiveUntil || availability.endsAt < tariff.effectiveUntil))) {
          throw new ConflictError("Explicit availability for this exact scope and locator must cover the tariff effective window.", "PLATFORM_OPERATIONAL_TARIFF_NOT_ENABLED");
        }
        const overlap = await tx.platformOperationalTariff.findFirst({
          where: {
            id: { not: id },
            ...locator(tariff),
            parcelCategory: tariff.parcelCategory,
            currency: tariff.currency,
            status: "ACTIVE",
            minWeightGrams: { lte: tariff.maxWeightGrams },
            OR: [{ maxWeightGrams: null }, { maxWeightGrams: { gte: tariff.minWeightGrams } }],
            effectiveFrom: { lt: tariff.effectiveUntil ?? new Date("9999-12-31T00:00:00.000Z") },
            AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: tariff.effectiveFrom } }] }],
          },
        });
        if (overlap) throw new ConflictError("An active tariff overlaps this scope, locator, category, currency, weight range and effective period.", "PLATFORM_OPERATIONAL_TARIFF_OVERLAP");
        const updated = await tx.platformOperationalTariff.update({
          where: { id }, data: { status: "ACTIVE", publishedAt: now },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "PLATFORM_OPERATIONAL_TARIFF", entityId: id,
          action: "PLATFORM_OPERATIONAL_TARIFF_PUBLISHED", reason, before: view(tariff), after: view(updated),
        });
        return view(updated);
      }, { isolationLevel: "Serializable" });
    },

    async retire(id, actorUserId, reason) {
      return prismaClient.$transaction(async tx => {
        const tariff = await tx.platformOperationalTariff.findUnique({ where: { id } });
        if (!tariff) throw new NotFoundError("Operational tariff not found.", "PLATFORM_OPERATIONAL_TARIFF_NOT_FOUND");
        if (tariff.status !== "ACTIVE") throw new ConflictError("Only active operational tariffs can be retired.", "PLATFORM_OPERATIONAL_TARIFF_NOT_ACTIVE");
        const updated = await tx.platformOperationalTariff.update({ where: { id }, data: { status: "RETIRED" } });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "PLATFORM_OPERATIONAL_TARIFF", entityId: id,
          action: "PLATFORM_OPERATIONAL_TARIFF_RETIRED", reason, before: view(tariff), after: view(updated),
        });
        return view(updated);
      }, { isolationLevel: "Serializable" });
    },

    async setAvailability(input, actorUserId) {
      const { reason, ...data } = input;
      return prismaClient.$transaction(async tx => {
        await assertLocatorExists(tx, data);
        if (data.isEnabled) await assertLocatorServiceable(tx, data);
        const where = scopeAvailabilityWhere(data);
        const before = await tx.platformOperationalTariffAvailability.findFirst({ where });
        const after = before
          ? await tx.platformOperationalTariffAvailability.update({
            where: { id: before.id },
            data: { isEnabled: data.isEnabled, startsAt: data.startsAt ?? null, endsAt: data.endsAt ?? null },
          })
          : await tx.platformOperationalTariffAvailability.create({
            data: { ...locator(data), isEnabled: data.isEnabled, startsAt: data.startsAt ?? null, endsAt: data.endsAt ?? null },
          });
        await writeOperationalAuditEvent(tx, {
          actorUserId, entityType: "PLATFORM_OPERATIONAL_TARIFF_AVAILABILITY", entityId: after.id,
          action: "PLATFORM_OPERATIONAL_TARIFF_AVAILABILITY_UPDATED", reason, before: before ?? undefined, after,
        });
        return after;
      }, { isolationLevel: "Serializable" });
    },
  };
}
