import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";
import { ConflictError, NotFoundError } from "../../shared/http/app-error.js";

const view = row => ({ ...row, driverPayoutMinor: row.driverPayoutMinor.toString() });

function overlaps(a, b) {
  const aMax = a.maxWeightGrams ?? Number.MAX_SAFE_INTEGER;
  const bMax = b.maxWeightGrams ?? Number.MAX_SAFE_INTEGER;
  return a.minWeightGrams <= bMax && b.minWeightGrams <= aMax;
}

function scopeOf(rule) {
  return {
    serviceZoneId: rule.serviceZoneId,
    legType: rule.legType,
    parcelCategory: rule.parcelCategory,
    currency: rule.currency,
  };
}

export function createPlatformDriverPayoutService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async list(filters = {}) {
      const rows = await prismaClient.platformDriverPayoutRule.findMany({
        where: {
          ...(filters.serviceZoneId ? { serviceZoneId: filters.serviceZoneId } : {}),
          ...(filters.legType ? { legType: filters.legType } : {}),
          ...(filters.parcelCategory ? { parcelCategory: filters.parcelCategory } : {}),
          ...(filters.currency ? { currency: filters.currency } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        include: { serviceZone: { select: { id: true, code: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
      return rows.map(view);
    },

    async create(input, actorUserId) {
      const { reason, ...data } = input;
      return prismaClient.$transaction(async tx => {
        const zone = await tx.serviceZone.findUnique({
          where: { id: data.serviceZoneId },
          select: { id: true },
        });
        if (!zone) throw new NotFoundError("Service zone not found.", "SERVICE_ZONE_NOT_FOUND");

        const identity = scopeOf(data);
        const last = await tx.platformDriverPayoutRule.findFirst({
          where: identity,
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const rule = await tx.platformDriverPayoutRule.create({
          data: {
            ...identity,
            minWeightGrams: data.minWeightGrams,
            maxWeightGrams: data.maxWeightGrams ?? null,
            driverPayoutMinor: BigInt(data.driverPayoutMinor),
            effectiveFrom: data.effectiveFrom,
            effectiveUntil: data.effectiveUntil ?? null,
            version: (last?.version ?? 0) + 1,
            createdByUserId: actorUserId,
          },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId,
          entityType: "PLATFORM_DRIVER_PAYOUT_RULE",
          entityId: rule.id,
          action: "PLATFORM_DRIVER_PAYOUT_RULE_CREATED",
          reason,
          after: view(rule),
        });
        return view(rule);
      }, { isolationLevel: "Serializable" });
    },

    async publish(id, actorUserId, reason) {
      return prismaClient.$transaction(async tx => {
        const rule = await tx.platformDriverPayoutRule.findUnique({ where: { id } });
        if (!rule) throw new NotFoundError("Driver payout rule not found.", "PLATFORM_DRIVER_PAYOUT_RULE_NOT_FOUND");
        if (rule.status !== "DRAFT") throw new ConflictError("Only draft driver payout rules can be published.", "PLATFORM_DRIVER_PAYOUT_RULE_NOT_DRAFT");

        const now = clock();
        if (rule.effectiveFrom > now || (rule.effectiveUntil && rule.effectiveUntil <= now)) {
          throw new ConflictError("Driver payout rule is outside its effective window.", "PLATFORM_DRIVER_PAYOUT_RULE_OUTSIDE_EFFECTIVE_DATES");
        }

        const candidates = await tx.platformDriverPayoutRule.findMany({
          where: {
            id: { not: id },
            ...scopeOf(rule),
            status: "ACTIVE",
            effectiveFrom: { lt: rule.effectiveUntil ?? new Date("9999-12-31T00:00:00.000Z") },
            AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: rule.effectiveFrom } }] }],
          },
        });
        const overlap = candidates.find(candidate => overlaps(rule, candidate));
        if (overlap) {
          throw new ConflictError(
            "An active driver payout rule overlaps this zone, leg type, category, currency, weight range and effective period.",
            "PLATFORM_DRIVER_PAYOUT_RULE_OVERLAP",
          );
        }

        const updated = await tx.platformDriverPayoutRule.update({
          where: { id },
          data: { status: "ACTIVE", publishedAt: now },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId,
          entityType: "PLATFORM_DRIVER_PAYOUT_RULE",
          entityId: id,
          action: "PLATFORM_DRIVER_PAYOUT_RULE_PUBLISHED",
          reason,
          before: view(rule),
          after: view(updated),
        });
        return view(updated);
      }, { isolationLevel: "Serializable" });
    },

    async retire(id, actorUserId, reason) {
      return prismaClient.$transaction(async tx => {
        const rule = await tx.platformDriverPayoutRule.findUnique({ where: { id } });
        if (!rule) throw new NotFoundError("Driver payout rule not found.", "PLATFORM_DRIVER_PAYOUT_RULE_NOT_FOUND");
        if (rule.status !== "ACTIVE") throw new ConflictError("Only active driver payout rules can be retired.", "PLATFORM_DRIVER_PAYOUT_RULE_NOT_ACTIVE");
        const updated = await tx.platformDriverPayoutRule.update({ where: { id }, data: { status: "RETIRED" } });
        await writeOperationalAuditEvent(tx, {
          actorUserId,
          entityType: "PLATFORM_DRIVER_PAYOUT_RULE",
          entityId: id,
          action: "PLATFORM_DRIVER_PAYOUT_RULE_RETIRED",
          reason,
          before: view(rule),
          after: view(updated),
        });
        return view(updated);
      }, { isolationLevel: "Serializable" });
    },
  };
}
