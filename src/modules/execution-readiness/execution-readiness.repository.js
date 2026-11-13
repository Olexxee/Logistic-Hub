import { env } from "../../config/env.js";
import {
  activeServiceZoneWhere,
  eligibleParcelDriverWhere,
  parcelCapabilityForLegType,
} from "../drivers/driver-dispatch-eligibility.js";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED",
  "IN_PROGRESS", "ARRIVED_AT_DESTINATION",
];

export function createExecutionReadinessRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    findLeg(tx, deliveryLegId) {
      return tx.deliveryLeg.findUnique({
        where: { id: deliveryLegId },
        include: {
          parcelBooking: {
            include: {
              quotes: {
                where: { status: "ACCEPTED" },
                orderBy: { version: "desc" },
                take: 1,
                select: { id: true, status: true, currency: true, inputSnapshot: true, acceptedAt: true },
              },
              parcelPackages: {
                orderBy: { packageSequence: "asc" },
                select: {
                  id: true, packageSequence: true, packageCategory: true,
                  weightGrams: true, lengthMm: true, widthMm: true, heightMm: true,
                },
              },
            },
          },
        },
      });
    },

    findEligibleLocalDrivers(tx, leg, now) {
      const capability = parcelCapabilityForLegType(leg.type);
      if (!capability) return Promise.resolve([]);
      const requiredServiceZoneIds = [...new Set([
        leg.originServiceZoneId,
        leg.destinationServiceZoneId,
      ])];
      return tx.driverProfile.findMany({
        where: {
          ...eligibleParcelDriverWhere({
            capability,
            now,
            strictMode: env.DRIVER_KYC_MODE === "STRICT",
            kycTiers: ["FULL"],
          }),
          lastLocationAt: {
            gte: new Date(now.getTime() - env.DRIVER_LOCATION_MAX_AGE_SECONDS * 1000),
            lte: now,
          },
          AND: [
            ...requiredServiceZoneIds.map(serviceZoneId => ({
              coverage: {
                some: {
                  serviceZoneId,
                  serviceType: "PARCEL_DELIVERY",
                  isEnabled: true,
                  serviceZone: { is: activeServiceZoneWhere(now) },
                },
              },
            })),
          ],
          assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
        },
        select: {
          id: true,
          serviceRadiusMeters: true,
          lastLocationAt: true,
          locations: {
            orderBy: { recordedAt: "desc" },
            take: 1,
            select: { latitude: true, longitude: true, recordedAt: true },
          },
        },
      });
    },

    findActiveHub(tx, hubPointId, now) {
      if (!hubPointId) return Promise.resolve(null);
      return tx.hubPoint.findUnique({
        where: { id: hubPointId },
        include: {
          serviceZone: {
            select: {
              id: true, isActive: true,
              state: { select: { isActive: true, country: { select: { isActive: true } } } },
              availability: {
                where: {
                  serviceType: "PARCEL_DELIVERY",
                  isEnabled: true,
                  AND: [
                    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                  ],
                },
                select: { id: true },
              },
            },
          },
          intakeRecords: {
            where: { status: { in: ["RECEIVED", "EXCEPTION"] } },
            select: { weightGrams: true, volumeCm3: true },
          },
        },
      });
    },

    findPartnerRates(tx, leg, packages, currency, now) {
      return tx.partnerRate.findMany({
        where: {
          originServiceZoneId: leg.originServiceZoneId,
          destinationServiceZoneId: leg.destinationServiceZoneId,
          serviceType: "PARCEL_DELIVERY",
          isActive: true,
          parcelCategory: { in: [...new Set(packages.map(pkg => pkg.packageCategory))] },
          rateCard: {
            is: {
              status: "ACTIVE",
              currency,
              effectiveFrom: { lte: now },
              AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
              agreement: {
                is: {
                  status: "ACTIVE",
                  currency,
                  effectiveFrom: { lte: now },
                  AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
                  partner: { is: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
                },
              },
            },
          },
        },
        include: {
          rateCard: {
            include: {
              agreement: {
                include: { partner: { select: { id: true, displayName: true } } },
              },
            },
          },
        },
        orderBy: [{ rateCardId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
    },

    findActiveServiceZones(tx, serviceZoneIds, now) {
      return tx.serviceZone.findMany({
        where: {
          id: { in: serviceZoneIds },
          ...activeServiceZoneWhere(now),
        },
        select: { id: true },
      });
    },
  };
}
