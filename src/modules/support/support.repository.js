import { randomBytes } from "node:crypto";

export function createSupportRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    findBookingContext({ bookingType, bookingId }) {
      return bookingType === "PASSENGER_RIDE"
        ? prismaClient.rideBooking.findUnique({ where: { id: bookingId }, select: { id: true, passengerId: true, status: true, paymentStatus: true, publicReference: true } })
        : prismaClient.parcelBooking.findUnique({ where: { id: bookingId }, select: { id: true, senderId: true, status: true, paymentStatus: true, publicReference: true } });
    },
    createTicket(data) { return prismaClient.supportTicket.create({ data }); },
    listMine(requesterId, cursor, limit) {
      return prismaClient.supportTicket.findMany({
        where: { requesterId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
    },
    listAdmin({ status, priority, cursor, limit }) {
      return prismaClient.supportTicket.findMany({
        where: { ...(status ? { status } : {}), ...(priority ? { priority } : {}) },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: limit + 1,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
    },
    findTicket(id) { return prismaClient.supportTicket.findUnique({ where: { id } }); },
    findSupportAgent(id) { return prismaClient.user.findFirst({ where: { id, role: { in: ["ADMIN", "SUPPORT"] }, status: "ACTIVE" }, select: { id: true } }); }
    updateTicket(id, data) { return prismaClient.supportTicket.update({ where: { id }, data }); },
    async cancelBooking({ bookingType, bookingId, userId, reason, now }) {
      return prismaClient.$transaction(async (tx) => {
        const isRide = bookingType === "PASSENGER_RIDE";
        const booking = isRide
          ? await tx.rideBooking.findUnique({ where: { id: bookingId } })
          : await tx.parcelBooking.findUnique({ where: { id: bookingId } });
        if (!booking) return { kind: "NOT_FOUND" };
        const ownerId = isRide ? booking.passengerId : booking.senderId;
        if (ownerId !== userId) return { kind: "FORBIDDEN" };
        const prePayment = ["DRAFT", "MATCHING", "AWAITING_CUSTOMER_ACCEPTANCE", "AWAITING_PAYMENT"].includes(booking.status)
          && ["INITIALIZED", "FAILED", "ABANDONED"].includes(booking.paymentStatus);
        if (prePayment) {
          const updated = isRide
            ? await tx.rideBooking.updateMany({ where: { id: bookingId, status: booking.status, paymentStatus: booking.paymentStatus }, data: { status: "CANCELLED", cancelledAt: now, cancellationReason: reason } })
            : await tx.parcelBooking.updateMany({ where: { id: bookingId, status: booking.status, paymentStatus: booking.paymentStatus }, data: { status: "CANCELLED", cancelledAt: now, cancellationReason: reason } });
          if (updated.count !== 1) return { kind: "CONFLICT" };
          await tx.driverOffer.updateMany({
            where: { ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }), status: { in: ["OFFERED", "ACCEPTED"] } },
            data: { status: "WITHDRAWN" },
          });
          await tx.driverAssignment.updateMany({
            where: { ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }), status: "AWAITING_PAYMENT" },
            data: { status: "CANCELLED", cancelledAt: now, failureReason: "CUSTOMER_CANCELLED_BEFORE_PAYMENT" },
          });
          await tx.bookingEvent.create({
            data: { ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }), actorUserId: userId, eventType: "BOOKING_CANCELLED", fromStatus: booking.status, toStatus: "CANCELLED", metadata: { reason, policy: "PRE_PAYMENT_NO_FEE" } },
          });
          return { kind: "CANCELLED", status: "CANCELLED", publicReference: booking.publicReference };
        }
        if (booking.paymentStatus === "PENDING") return { kind: "PAYMENT_PENDING" };
        const canRequest = !["COMPLETED", "CANCELLED", "FAILED", "CANCELLATION_PENDING"].includes(booking.status);
        if (!canRequest) return { kind: "CONFLICT" };
        const beforePickup = booking.status === "DRIVER_ASSIGNED" && booking.paymentStatus === "SUCCEEDED";
        if (booking.paymentStatus === "SUCCEEDED" && !beforePickup) {
          const ticket = await tx.supportTicket.create({
            data: {
              publicReference: `LH-SUP-${randomBytes(5).toString("hex").toUpperCase()}`,
              requesterId: userId,
              ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
              category: "SAFETY",
              subject: `Urgent assistance requested for ${booking.publicReference}`,
              description: reason,
              priority: "URGENT",
            },
          });
          return { kind: "SAFETY_REVIEW", status: booking.status, supportTicketReference: ticket.publicReference };
        }
        if (booking.paymentStatus === "SUCCEEDED" && !beforePickup) return { kind: "CONFLICT" };
        const ticket = await tx.supportTicket.create({
          data: {
            publicReference: `LH-SUP-${randomBytes(5).toString("hex").toUpperCase()}`,
            requesterId: userId,
            ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }),
            category: "CANCELLATION_REFUND",
            subject: `Cancellation request for ${booking.publicReference}`,
            description: reason,
            priority: "HIGH",
          },
        });
        if (booking.paymentStatus !== "PENDING") {
          const updated = isRide
            ? await tx.rideBooking.updateMany({ where: { id: bookingId, status: booking.status }, data: { status: "CANCELLATION_PENDING", cancellationReason: reason } })
            : await tx.parcelBooking.updateMany({ where: { id: bookingId, status: booking.status }, data: { status: "CANCELLATION_PENDING", cancellationReason: reason } });
          if (updated.count !== 1) throw Object.assign(new Error("Booking state changed concurrently."), { statusCode: 409, code: "CANCELLATION_STATE_CONFLICT" });
          await tx.driverAssignment.updateMany({
            where: { ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }), status: "ACCEPTED" },
            data: { status: "CANCELLED", cancelledAt: now, failureReason: "CUSTOMER_CANCELLED_POST_PAYMENT_PENDING_REVIEW" },
          });
          await tx.bookingEvent.create({
            data: { ...(isRide ? { rideBookingId: bookingId } : { parcelBookingId: bookingId }), actorUserId: userId, eventType: "CANCELLATION_REQUESTED", fromStatus: booking.status, toStatus: "CANCELLATION_PENDING", metadata: { reason, supportTicketId: ticket.id, policy: "POST_PAYMENT_REVIEW_REQUIRED" } },
          });
        }
        return { kind: "REVIEW_REQUIRED", status: "CANCELLATION_PENDING", supportTicketReference: ticket.publicReference, paymentPending: booking.paymentStatus === "PENDING" };
      });
    },
  };
}
