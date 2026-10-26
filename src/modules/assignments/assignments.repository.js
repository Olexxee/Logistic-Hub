function stateConflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = "ASSIGNMENT_STATE_CONFLICT";
  return error;
}

export function createAssignmentsRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  const contextInclude = {
    driverProfile: { select: { id: true, userId: true } },
    rideBooking: { select: { id: true, passengerId: true, status: true, paymentStatus: true, publicReference: true } },
    parcelBooking: { select: { id: true, senderId: true, status: true, paymentStatus: true, publicReference: true } },
  };
  return {
    findContext(id, tx = prismaClient) {
      return tx.driverAssignment.findUnique({ where: { id }, include: contextInclude });
    },
    createVerification({ assignment, action, tokenHash, expiresAt }, tx = prismaClient) {
      return tx.$transaction(async (inner) => {
        await inner.verificationToken.updateMany({
          where: {
            status: "ACTIVE",
            action,
            ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : { parcelBookingId: assignment.parcelBookingId }),
          },
          data: { status: "REVOKED" },
        });
        return inner.verificationToken.create({
          data: {
            action,
            tokenHash,
            expiresAt,
            ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : { parcelBookingId: assignment.parcelBookingId }),
          },
          select: { id: true, expiresAt: true },
        });
      });
    },
    async updateAssignmentStatus({ id, from, to, timestampField, now }, tx = prismaClient) {
      return tx.driverAssignment.updateMany({
        where: { id, status: from },
        data: { status: to, ...(timestampField ? { [timestampField]: now } : {}) },
      });
    },
    async markArrivedAtPickup({ assignment, actorUserId, now }) {
      return prismaClient.$transaction(async (tx) => {
        const updated = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: "ACCEPTED" },
          data: { status: "ARRIVED_AT_PICKUP" },
        });
        if (updated.count !== 1) throw stateConflict("Assignment state changed concurrently.");
        const booking = assignment.rideBooking ?? assignment.parcelBooking;
        const isRide = Boolean(assignment.rideBookingId);
        await tx.bookingEvent.create({
          data: {
            ...(isRide ? { rideBookingId: booking.id } : { parcelBookingId: booking.id }),
            actorUserId,
            eventType: "DRIVER_ARRIVED_AT_PICKUP",
            fromStatus: isRide ? "DRIVER_ASSIGNED" : "DRIVER_ASSIGNED",
            toStatus: "PICKUP_VERIFICATION_PENDING",
            metadata: { assignmentId: assignment.id },
          },
        });
        const bookingChanged = isRide
          ? await tx.rideBooking.updateMany({ where: { id: booking.id, status: "DRIVER_ASSIGNED", paymentStatus: "SUCCEEDED" }, data: { status: "PICKUP_VERIFICATION_PENDING" } })
          : await tx.parcelBooking.updateMany({ where: { id: booking.id, status: "DRIVER_ASSIGNED", paymentStatus: "SUCCEEDED" }, data: { status: "PICKUP_VERIFICATION_PENDING" } });
        if (bookingChanged.count !== 1) throw stateConflict("Booking is not in a paid, driver-assigned state.");
        return true;
      });
    },
    async consumeCodeAndTransition({ assignment, tokenHash, action, actorUserId, now }) {
      return prismaClient.$transaction(async (tx) => {
        const token = await tx.verificationToken.findFirst({
          where: {
            tokenHash, action, status: "ACTIVE", expiresAt: { gt: now },
            ...(assignment.rideBookingId ? { rideBookingId: assignment.rideBookingId } : { parcelBookingId: assignment.parcelBookingId }),
          },
        });
        if (!token) return { ok: false, reason: "INVALID_CODE" };
        const consumed = await tx.verificationToken.updateMany({
          where: { id: token.id, status: "ACTIVE", expiresAt: { gt: now } },
          data: { status: "CONSUMED", consumedAt: now, consumedByUserId: actorUserId },
        });
        if (consumed.count !== 1) return { ok: false, reason: "INVALID_CODE" };

        const isRide = Boolean(assignment.rideBookingId);
        const booking = isRide ? assignment.rideBooking : assignment.parcelBooking;
        let assignmentFrom;
        let assignmentTo;
        let bookingFrom;
        let bookingTo;
        let timestampField;
        if (action === "RIDE_PICKUP" || action === "PARCEL_PICKUP") {
          assignmentFrom = "ARRIVED_AT_PICKUP";
          assignmentTo = isRide ? "IN_PROGRESS" : "PICKUP_CONFIRMED";
          bookingFrom = "PICKUP_VERIFICATION_PENDING";
          bookingTo = isRide ? "TRIP_IN_PROGRESS" : "PICKED_UP";
          timestampField = isRide ? "startedAt" : "pickupAt";
        } else {
          assignmentFrom = "ARRIVED_AT_DESTINATION";
          assignmentTo = "COMPLETED";
          bookingFrom = isRide ? "TRIP_COMPLETION_PENDING" : "DELIVERY_VERIFICATION_PENDING";
          bookingTo = "COMPLETED";
          timestampField = "completedAt";
        }
        const changed = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: assignmentFrom },
          data: { status: assignmentTo, [timestampField]: now, ...(assignmentTo === "COMPLETED" ? { completedAt: now } : {}) },
        });
        if (changed.count !== 1) throw stateConflict("Assignment state changed concurrently.");
        const bookingChanged = isRide
          ? await tx.rideBooking.updateMany({
              where: { id: booking.id, status: bookingFrom, paymentStatus: "SUCCEEDED" },
              data: {
                status: bookingTo,
                ...(bookingTo === "TRIP_IN_PROGRESS" ? { tripStartedAt: now } : {}),
                ...(bookingTo === "COMPLETED" ? { completedAt: now } : {}),
              },
            })
          : await tx.parcelBooking.updateMany({
              where: { id: booking.id, status: bookingFrom, paymentStatus: "SUCCEEDED" },
              data: {
                status: bookingTo,
                ...(bookingTo === "PICKED_UP" ? { pickedUpAt: now } : {}),
                ...(bookingTo === "COMPLETED" ? { completedAt: now } : {}),
              },
            });
        if (bookingChanged.count !== 1) throw stateConflict("Booking state changed concurrently.");
        await tx.bookingEvent.create({
          data: {
            ...(isRide ? { rideBookingId: booking.id } : { parcelBookingId: booking.id }),
            actorUserId,
            eventType: action === "RIDE_PICKUP" || action === "PARCEL_PICKUP" ? "PICKUP_VERIFIED" : "DELIVERY_VERIFIED",
            fromStatus: bookingFrom,
            toStatus: bookingTo,
            metadata: { assignmentId: assignment.id, verificationTokenId: token.id },
          },
        });
        return { ok: true, status: bookingTo };
      });
    },
    async markArrivedAtDestination({ assignment, actorUserId, now }) {
      return prismaClient.$transaction(async (tx) => {
        const updated = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: "IN_PROGRESS" },
          data: { status: "ARRIVED_AT_DESTINATION" },
        });
        if (updated.count !== 1) return false;
        const isRide = Boolean(assignment.rideBookingId);
        const booking = isRide ? assignment.rideBooking : assignment.parcelBooking;
        const from = isRide ? "TRIP_IN_PROGRESS" : "IN_TRANSIT";
        const to = isRide ? "TRIP_COMPLETION_PENDING" : "DELIVERY_VERIFICATION_PENDING";
        const bookingChanged = isRide
          ? await tx.rideBooking.updateMany({ where: { id: booking.id, status: from, paymentStatus: "SUCCEEDED" }, data: { status: to } })
          : await tx.parcelBooking.updateMany({ where: { id: booking.id, status: from, paymentStatus: "SUCCEEDED" }, data: { status: to } });
        if (bookingChanged.count !== 1) throw stateConflict("Booking is not in the expected active state.");
        await tx.bookingEvent.create({
          data: {
            ...(isRide ? { rideBookingId: booking.id } : { parcelBookingId: booking.id }),
            actorUserId,
            eventType: "DRIVER_ARRIVED_AT_DESTINATION",
            fromStatus: from,
            toStatus: to,
            metadata: { assignmentId: assignment.id },
          },
        });
        return true;
      });
    },
    async latestLocation(driverProfileId) {
      return prismaClient.driverLocation.findFirst({
        where: { driverProfileId },
        orderBy: { recordedAt: "desc" },
        select: { latitude: true, longitude: true, accuracyMeters: true, recordedAt: true },
      });
    },

    async startParcelTransit({ assignment, actorUserId, now }) {
      return prismaClient.$transaction(async (tx) => {
        const updated = await tx.driverAssignment.updateMany({
          where: { id: assignment.id, status: "PICKUP_CONFIRMED", parcelBookingId: { not: null } },
          data: { status: "IN_PROGRESS", startedAt: now },
        });
        if (updated.count !== 1) throw stateConflict("Parcel assignment is not ready to enter transit.");
        const bookingChanged = await tx.parcelBooking.updateMany({
          where: { id: assignment.parcelBookingId, status: "PICKED_UP", paymentStatus: "SUCCEEDED" },
          data: { status: "IN_TRANSIT" },
        });
        if (bookingChanged.count !== 1) throw stateConflict("Parcel booking is not in the picked-up state.");
        await tx.bookingEvent.create({
          data: { parcelBookingId: assignment.parcelBookingId, actorUserId, eventType: "PARCEL_IN_TRANSIT", fromStatus: "PICKED_UP", toStatus: "IN_TRANSIT", metadata: { assignmentId: assignment.id } },
        });
        return true;
      });
    },
  };
}
