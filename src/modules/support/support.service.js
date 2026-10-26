import { randomBytes } from "node:crypto";
import { createSupportRepository } from "./support.repository.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";

export function createSupportService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createSupportRepository({ prismaClient });
  return {
    async createTicket({ requester, input }) {
      let bookingData = {};
      if (input.bookingId) {
        const booking = await db.findBookingContext({ bookingType: input.bookingType, bookingId: input.bookingId });
        if (!booking) throw new NotFoundError("The booking was not found.");
        const owner = input.bookingType === "PASSENGER_RIDE" ? booking.passengerId : booking.senderId;
        if (owner !== requester.id && !["ADMIN", "SUPPORT"].includes(requester.role)) throw new ForbiddenError("You cannot open a ticket for this booking.");
        bookingData = input.bookingType === "PASSENGER_RIDE" ? { rideBookingId: booking.id } : { parcelBookingId: booking.id };
      }
      return db.createTicket({
        publicReference: `LH-SUP-${randomBytes(5).toString("hex").toUpperCase()}`,
        requesterId: requester.id,
        ...bookingData,
        category: input.category,
        subject: input.subject,
        description: input.description,
      });
    },
    async listMine({ requesterId, cursor, limit = 20 }) {
      const rows = await db.listMine(requesterId, cursor, limit);
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
    },
    async listAdmin({ status, priority, cursor, limit = 50 }) {
      const rows = await db.listAdmin({ status, priority, cursor, limit });
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
    },
    async updateTicket({ ticketId, actor, input }) {
      const ticket = await db.findTicket(ticketId);
      if (!ticket) throw new NotFoundError("The support ticket was not found.");
      if (ticket.status === "CLOSED" && input.status && input.status !== "CLOSED") throw new ConflictError("Closed tickets cannot be reopened through this endpoint.", "TICKET_CLOSED");
      if (input.assignedToUserId) {
        const agent = await db.findSupportAgent(input.assignedToUserId);
        if (!agent) throw new ValidationError("The assignee must be an active support agent or administrator.");
      }
      const data = {
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId || null } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      };
      if (input.status === "CLOSED" || input.status === "RESOLVED") data.closedAt = clock();
      return db.updateTicket(ticketId, data);
    },
    async cancelBooking({ bookingType, bookingId, user, reason }) {
      const result = await db.cancelBooking({ bookingType, bookingId, userId: user.id, reason, now: clock() });
      if (result.kind === "NOT_FOUND") throw new NotFoundError("The booking was not found.");
      if (result.kind === "FORBIDDEN") throw new ForbiddenError("You cannot cancel this booking.");
      if (result.kind === "PAYMENT_PENDING") throw new ConflictError("Payment is still being verified. Wait for the result, then submit a cancellation request if needed.", "PAYMENT_PENDING_CANNOT_CANCEL");
      if (result.kind === "CONFLICT") throw new ConflictError("The booking cannot be cancelled in its current state.", "CANCELLATION_STATE_CONFLICT");
      return result;
    },
  };
}
