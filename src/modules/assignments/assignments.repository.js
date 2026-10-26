export function createAssignmentsRepository({ prismaClient }) {
  return {
    findLatestLocation(driverProfileId) { return prismaClient.driverLocation.findFirst({ where: { driverProfileId }, orderBy: { recordedAt: "desc" }, select: { latitude: true, longitude: true, accuracyMeters: true, recordedAt: true } }); },
    findById(id) {
      return prismaClient.driverAssignment.findUnique({
        where: { id },
        include: {
          driverProfile: { select: { id: true, userId: true } },
          parcelBooking: { select: { id: true, senderId: true, status: true, paymentStatus: true } },
          rideBooking: { select: { id: true, passengerId: true, status: true, paymentStatus: true } },
        },
      });
    },
    async createVerification({ assignment, action, tokenHash, expiresAt }) {
      return prismaClient.verificationToken.create({
        data: {
          ...(assignment.parcelBookingId ? { parcelBookingId: assignment.parcelBookingId } : {}),
          ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : {}),
          action, tokenHash, expiresAt,
        },
        select: { id: true, action: true, expiresAt: true },
      });
    },
    async transition({ assignment, fromStatuses, toStatus, actorUserId, eventType, bookingStatus, bookingPaymentStatus }) {
      return prismaClient.$transaction(async (tx) => {
        const changed = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: { in: fromStatuses } },
          data: {
            status: toStatus,
            ...(toStatus === "ARRIVED_AT_PICKUP" ? { acceptedAt: assignment.acceptedAt ?? new Date() } : {}),
            ...(toStatus === "IN_PROGRESS" ? { startedAt: new Date(), pickupAt: assignment.pickupAt ?? new Date() } : {}),
            ...(toStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
          },
        });
        if (changed.count !== 1) return null;
        if (assignment.rideBookingId) {
          await tx.rideBooking.update({ where: { id: assignment.rideBookingId }, data: {
            ...(bookingStatus ? { status: bookingStatus } : {}),
            ...(bookingPaymentStatus ? { paymentStatus: bookingPaymentStatus } : {}),
            ...(toStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
            ...(toStatus === "IN_PROGRESS" ? { tripStartedAt: new Date() } : {}),
          } });
        } else if (assignment.parcelBookingId) {
          await tx.parcelBooking.update({ where: { id: assignment.parcelBookingId }, data: {
            ...(bookingStatus ? { status: bookingStatus } : {}),
            ...(bookingPaymentStatus ? { paymentStatus: bookingPaymentStatus } : {}),
            ...(toStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
            ...(toStatus === "IN_PROGRESS" ? { pickedUpAt: new Date() } : {}),
          } });
        }
        await tx.bookingEvent.create({
          data: {
            ...(assignment.parcelBookingId ? { parcelBookingId: assignment.parcelBookingId } : {}),
            ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : {}),
            actorUserId, eventType, fromStatus: fromStatuses.join("|"), toStatus,
          },
        });
        if (toStatus === "COMPLETED") {
          await tx.driverProfile.update({ where: { id: assignment.driverProfileId }, data: { completedJobs: { increment: 1 }, isAvailable: true } });
        }
        return tx.driverAssignment.findUnique({ where: { id: assignment.id } });
      });
    },
    async consumeVerification({ assignment, action, tokenHash, actorUserId }) {
      return prismaClient.$transaction(async (tx) => {
        const token = await tx.verificationToken.findFirst({
          where: {
            ...(assignment.parcelBookingId ? { parcelBookingId: assignment.parcelBookingId } : {}),
            ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : {}),
            action, tokenHash, status: "ACTIVE", consumedAt: null, expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!token) return false;
        const changed = await tx.verificationToken.updateMany({
          where: { id: token.id, status: "ACTIVE", consumedAt: null, expiresAt: { gt: new Date() } },
          data: { status: "CONSUMED", consumedAt: new Date(), consumedByUserId: actorUserId },
        });
        if (changed.count !== 1) return false;
        const isRide = Boolean(assignment.rideBookingId);
        const completed = action === "RIDE_COMPLETION" || action === "PARCEL_DELIVERY";
        const nextStatus = completed ? "COMPLETED" : "IN_PROGRESS";
        const changedAssignment = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: { in: completed ? ["ARRIVED_AT_DESTINATION", "IN_PROGRESS"] : ["ARRIVED_AT_PICKUP"] } },
          data: { status: nextStatus, ...(completed ? { completedAt: new Date() } : { startedAt: new Date(), pickupAt: new Date() }) },
        });
        if (changedAssignment.count !== 1) throw Object.assign(new Error("Assignment state changed; request a new verification code."), { statusCode: 409, code: "ASSIGNMENT_STATE_CONFLICT" });
        if (isRide) {
          await tx.rideBooking.update({ where: { id: assignment.rideBookingId }, data: completed
            ? { status: "COMPLETED", completedAt: new Date() }
            : { status: "TRIP_IN_PROGRESS", tripStartedAt: new Date() } });
        } else {
          await tx.parcelBooking.update({ where: { id: assignment.parcelBookingId }, data: completed
            ? { status: "COMPLETED", completedAt: new Date() }
            : { status: "PICKED_UP", pickedUpAt: new Date() } });
        }
        await tx.bookingEvent.create({
          data: {
            ...(assignment.parcelBookingId ? { parcelBookingId: assignment.parcelBookingId } : {}),
            ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : {}),
            actorUserId, eventType: completed ? "BOOKING_COMPLETED_BY_VERIFICATION" : "PICKUP_VERIFIED",
            fromStatus: assignment.status, toStatus: nextStatus,
          },
        });
        if (completed) await tx.driverProfile.update({ where: { id: assignment.driverProfileId }, data: { completedJobs: { increment: 1 }, isAvailable: true } });
        return true;
      });
    },
  };
}
