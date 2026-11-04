import { env } from "../../config/env.js";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "AWAITING_PAYMENT", "ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED",
  "IN_PROGRESS", "ARRIVED_AT_DESTINATION",
];
const ELIGIBLE_BOOKING_PAYMENT_STATUSES = ["INITIALIZED", "FAILED", "ABANDONED"];

export const DRIVER_ASSIGNMENT_PAYMENT_EXPIRY_REASON = "PAYMENT_WINDOW_EXPIRED";

export function createDriverAssignmentExpiryWorker({ prismaClient, clock = () => new Date(), batchSize = 100 }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  async function expireOne(assignmentId, now) {
    return prismaClient.$transaction(async (tx) => {
      const assignment = await tx.driverAssignment.findUnique({
        where: { id: assignmentId },
        include: { parcelBooking: true, rideBooking: true, deliveryLeg: true },
      });
      if (!assignment || assignment.status !== "AWAITING_PAYMENT"
        || !assignment.paymentExpiresAt || assignment.paymentExpiresAt > now) return false;

      const isParcel = Boolean(assignment.parcelBookingId);
      const booking = isParcel ? assignment.parcelBooking : assignment.rideBooking;
      if (!booking || booking.status !== "AWAITING_PAYMENT"
        || !ELIGIBLE_BOOKING_PAYMENT_STATUSES.includes(booking.paymentStatus)) return false;

      // Any provider attempt may still settle. Keep its reservation until a
      // separate reconciliation decision establishes a safe release outcome.
      const paymentAttempt = await tx.paymentAttempt.findFirst({
        where: {
          ...(isParcel ? { parcelBookingId: assignment.parcelBookingId } : { rideBookingId: assignment.rideBookingId }),
        },
        select: { id: true },
      });
      if (paymentAttempt) return false;
      if (assignment.deliveryLegId && assignment.deliveryLeg?.status !== "AWAITING_PAYMENT") return false;

      const released = await tx.driverAssignment.updateMany({
        where: { id: assignment.id, status: "AWAITING_PAYMENT", paymentExpiresAt: { lte: now } },
        data: { status: "FAILED", failureReason: DRIVER_ASSIGNMENT_PAYMENT_EXPIRY_REASON },
      });
      if (released.count !== 1) return false;

      if (assignment.deliveryLegId) {
        const legReleased = await tx.deliveryLeg.updateMany({
          where: { id: assignment.deliveryLegId, status: "AWAITING_PAYMENT" },
          data: { status: "READY_FOR_ASSIGNMENT", assignedAt: null, failureReason: null },
        });
        if (legReleased.count !== 1) {
          throw Object.assign(new Error("The delivery leg changed while releasing its expired reservation."), {
            code: "DELIVERY_LEG_RELEASE_CONFLICT",
          });
        }
        await tx.deliveryLegOffer.updateMany({
          where: { deliveryLegId: assignment.deliveryLegId, driverProfileId: assignment.driverProfileId, status: "ACCEPTED" },
          data: { status: "EXPIRED", respondedAt: now },
        });
      } else if (isParcel) {
        await tx.driverOffer.updateMany({
          where: { parcelBookingId: assignment.parcelBookingId, driverProfileId: assignment.driverProfileId, status: "ACCEPTED" },
          data: { status: "EXPIRED", respondedAt: now },
        });
        const bookingReleased = await tx.parcelBooking.updateMany({
          where: {
            id: assignment.parcelBookingId, status: "AWAITING_PAYMENT",
            paymentStatus: { in: ELIGIBLE_BOOKING_PAYMENT_STATUSES },
          },
          data: { status: "MATCHING", driverFareMinor: null, customerPayableMinor: null },
        });
        if (bookingReleased.count !== 1) {
          throw Object.assign(new Error("The parcel booking changed while releasing its expired reservation."), {
            code: "PARCEL_BOOKING_RELEASE_CONFLICT",
          });
        }
      } else {
        await tx.driverOffer.updateMany({
          where: { rideBookingId: assignment.rideBookingId, driverProfileId: assignment.driverProfileId, status: "ACCEPTED" },
          data: { status: "EXPIRED", respondedAt: now },
        });
        const bookingReleased = await tx.rideBooking.updateMany({
          where: {
            id: assignment.rideBookingId, status: "AWAITING_PAYMENT",
            paymentStatus: { in: ELIGIBLE_BOOKING_PAYMENT_STATUSES },
          },
          data: { status: "MATCHING", driverFareMinor: null, customerPayableMinor: null },
        });
        if (bookingReleased.count !== 1) {
          throw Object.assign(new Error("The ride booking changed while releasing its expired reservation."), {
            code: "RIDE_BOOKING_RELEASE_CONFLICT",
          });
        }
      }

      await tx.driverProfile.updateMany({
        where: {
          id: assignment.driverProfileId,
          isOnline: true,
          verificationStatus: "VERIFIED",
          kycTier: { in: env.DRIVER_KYC_MODE === "TEST" ? ["FULL", "TEST_LIMITED"] : ["FULL"] },
          suspendedAt: null,
          lastLocationAt: { gte: new Date(now.getTime() - 5 * 60_000), lte: now },
          user: { is: { role: "DRIVER", status: "ACTIVE", emailVerifiedAt: { not: null } } },
          assignments: { none: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } } },
        },
        data: { isAvailable: true },
      });

      await tx.bookingEvent.create({
        data: {
          ...(isParcel ? { parcelBookingId: assignment.parcelBookingId } : { rideBookingId: assignment.rideBookingId }),
          actorUserId: null,
          eventType: "ASSIGNMENT_PAYMENT_WINDOW_EXPIRED",
          fromStatus: "AWAITING_PAYMENT",
          toStatus: "FAILED",
          metadata: {
            assignmentId: assignment.id,
            driverProfileId: assignment.driverProfileId,
            ...(assignment.deliveryLegId ? { deliveryLegId: assignment.deliveryLegId } : {}),
            reason: DRIVER_ASSIGNMENT_PAYMENT_EXPIRY_REASON,
            paymentExpiresAt: assignment.paymentExpiresAt.toISOString(),
            systemSource: "DRIVER_ASSIGNMENT_EXPIRY_WORKER",
          },
        },
      });
      return true;
    });
  }

  return {
    async runOnce() {
      const now = clock();
      const candidates = await prismaClient.driverAssignment.findMany({
        where: {
          status: "AWAITING_PAYMENT",
          paymentExpiresAt: { lte: now },
          OR: [
            { parcelBooking: { is: {
              status: "AWAITING_PAYMENT",
              paymentStatus: { in: ELIGIBLE_BOOKING_PAYMENT_STATUSES },
              paymentAttempts: { none: {} },
            } } },
            { rideBooking: { is: {
              status: "AWAITING_PAYMENT",
              paymentStatus: { in: ELIGIBLE_BOOKING_PAYMENT_STATUSES },
              paymentAttempts: { none: {} },
            } } },
          ],
        },
        orderBy: [{ paymentExpiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      });
      let expired = 0;
      for (const candidate of candidates) {
        if (await expireOne(candidate.id, now)) expired += 1;
      }
      return { scanned: candidates.length, expired };
    },
  };
}
