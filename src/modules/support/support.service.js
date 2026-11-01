import { randomBytes, randomUUID } from "node:crypto";
import { createSupportRepository } from "./support.repository.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

async function serializableTransaction(prismaClient, callback) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await prismaClient.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (error) { if (error?.code !== "P2034" || attempt >= 2) throw error; }
  }
}

const ALLOWED_TRANSITIONS = {
  OPEN: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
};

export function createSupportService({ prismaClient, clock = () => new Date() }) {
  const repo = createSupportRepository(prismaClient);
  return {
    async create({ user, input }) {
      if (input.bookingId && !input.bookingType) {
        throw new ValidationError("bookingType is required when a bookingId is supplied.");
      }
      if (input.bookingId) {
        const booking = await repo.findOwnedBooking({ bookingType: input.bookingType, bookingId: input.bookingId, userId: user.id });
        if (!booking) throw new NotFoundError("The related booking was not found or is not owned by this account.");
      }
      return repo.createTicket({
        publicReference: "SUP-" + randomBytes(5).toString("hex").toUpperCase(),
        customerId: user.id,
        bookingType: input.bookingType,
        bookingId: input.bookingId,
        category: input.category,
        subject: input.subject,
        description: input.description,
      });
    },
    async listMine({ userId, cursor, limit = 20 }) {
      const rows = await repo.listMine({ customerId: userId, cursor, limit });
      return { data: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]?.id ?? null : null };
    },
    async listAdmin({ status, category, priority, assignedToUserId, unassignedOnly, q, cursor, limit = 50 }) {
      const rows = await repo.listAdmin({ status, category, priority, assignedToUserId, unassignedOnly, q, cursor, limit });
      return { data: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]?.id ?? null : null };
    },
    async listMessages({ ticketId, user }) {
      const ticket = await repo.findById(ticketId);
      if (!ticket) throw new NotFoundError("Support ticket not found.");
      const isSupport = ["ADMIN", "SUPPORT"].includes(user.role);
      if (!isSupport && ticket.customerId !== user.id) throw new NotFoundError("Support ticket not found.");
      return {
        data: await repo.listMessages({ ticketId, includeInternal: isSupport }),
      };
    },
    async createMessage({ ticketId, user, input }) {
      const isSupport = ["ADMIN", "SUPPORT"].includes(user.role);
      if (!isSupport && input.visibility === "INTERNAL") {
        throw new ForbiddenError("Customers cannot create internal support notes.");
      }
      return prismaClient.$transaction(async tx => {
        const txRepo = createSupportRepository(tx);
        const ticket = await txRepo.findById(ticketId);
        if (!ticket || (!isSupport && ticket.customerId !== user.id)) {
          throw new NotFoundError("Support ticket not found.");
        }
        if (ticket.status === "CLOSED") {
          throw new ConflictError("Closed support tickets cannot receive new messages.", "SUPPORT_TICKET_CLOSED");
        }
        const message = await txRepo.createMessage({
          ticketId,
          authorId: user.id,
          visibility: isSupport ? input.visibility : "PUBLIC",
          body: input.body,
        }, tx);
        await writeOperationalAuditEvent(tx, {
          actorUserId: user.id,
          entityType: "SUPPORT_TICKET",
          entityId: ticketId,
          action: "SUPPORT_TICKET_MESSAGE_CREATED",
          metadata: { messageId: message.id, visibility: message.visibility },
        });
        return message;
      });
    },
    async escalate({ id, user, input }) {
      if (!["ADMIN", "SUPPORT"].includes(user.role)) throw new ForbiddenError();
      return serializableTransaction(prismaClient, async tx => {
        const ticket = await tx.supportTicket.findUnique({ where: { id } });
        if (!ticket) throw new NotFoundError("Support ticket not found.");
        if (ticket.status === "CLOSED") throw new ConflictError("Closed support tickets cannot be escalated.", "SUPPORT_TICKET_CLOSED");
        if (ticket.operationalCaseId) {
          const operationalCase = await tx.operationalCase.findUnique({ where: { id: ticket.operationalCaseId } });
          if (operationalCase) return { ticket, operationalCase, replay: true };
        }
        if (ticket.bookingType !== "PARCEL" || !(ticket.parcelBookingId || ticket.bookingId)) {
          throw new ConflictError("Only support tickets linked to a parcel booking can be escalated to a parcel operational case.", "PARCEL_BOOKING_REQUIRED");
        }
        const parcelBookingId = ticket.parcelBookingId || ticket.bookingId;
        const booking = await tx.parcelBooking.findFirst({
          where: { id: parcelBookingId, senderId: ticket.customerId },
          select: { id: true, publicReference: true },
        });
        if (!booking) throw new ConflictError("The ticket's parcel booking could not be verified.", "PARCEL_BOOKING_NOT_FOUND");
        const operationalCase = await tx.operationalCase.create({
          data: {
            publicReference: "CASE-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
            type: input.caseType,
            status: "OPEN",
            priority: input.priority ?? "NORMAL",
            parcelBookingId: booking.id,
            reportedByUserId: user.id,
            title: ticket.subject,
            description: ticket.description + "\n\nEscalated from support ticket " + ticket.publicReference + ".",
            evidence: { supportTicketId: ticket.id, supportTicketReference: ticket.publicReference },
          },
        });
        const updatedTicket = await tx.supportTicket.update({
          where: { id },
          data: { operationalCaseId: operationalCase.id },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId: user.id,
          entityType: "OPERATIONAL_CASE",
          entityId: operationalCase.id,
          action: "OPERATIONAL_CASE_CREATED_FROM_SUPPORT_TICKET",
          after: {
            supportTicketId: ticket.id,
            supportTicketReference: ticket.publicReference,
            parcelBookingId: booking.id,
            type: operationalCase.type,
            priority: operationalCase.priority,
          },
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId: user.id,
          entityType: "SUPPORT_TICKET",
          entityId: id,
          action: "SUPPORT_TICKET_ESCALATED_TO_OPERATIONAL_CASE",
          before: { operationalCaseId: ticket.operationalCaseId ?? null },
          after: { operationalCaseId: operationalCase.id, operationalCaseReference: operationalCase.publicReference },
        });
        return { ticket: updatedTicket, operationalCase, replay: false };
      });
    },
    async update({ id, user, input }) {
      if (!["ADMIN", "SUPPORT"].includes(user.role)) throw new ForbiddenError();
      return prismaClient.$transaction(async tx => {
        const txRepo = createSupportRepository(tx);
        const existing = await txRepo.findById(id);
        if (!existing) throw new NotFoundError("Support ticket not found.");

        if (existing.status === "CLOSED" && input.status !== undefined) {
          throw new ConflictError("Closed support tickets cannot be changed.", "SUPPORT_TICKET_CLOSED");
        }
        if (input.status && input.status !== existing.status && !ALLOWED_TRANSITIONS[existing.status]?.includes(input.status)) {
          throw new ConflictError("The requested support ticket status transition is not allowed.", "INVALID_SUPPORT_TICKET_TRANSITION");
        }
        if (["RESOLVED", "CLOSED"].includes(input.status ?? existing.status) && !(input.resolution ?? existing.resolution)?.trim()) {
          throw new ValidationError("A resolution summary is required before resolving or closing a ticket.");
        }

        if (input.assignedToUserId) {
          const assignee = await tx.user.findUnique({
            where: { id: input.assignedToUserId },
            select: { id: true, role: true },
          });
          if (!assignee || !["ADMIN", "SUPPORT"].includes(assignee.role)) {
            throw new ValidationError("Tickets can only be assigned to an existing ADMIN or SUPPORT account.");
          }
        }

        const updated = await txRepo.updateTicket({
          id,
          data: {
            ...input,
            assignedToUserId: input.assignedToUserId === undefined ? existing.assignedToUserId : input.assignedToUserId,
          },
          now: clock(),
        });
        await writeOperationalAuditEvent(tx, {
          actorUserId: user.id,
          entityType: "SUPPORT_TICKET",
          entityId: id,
          action: "SUPPORT_TICKET_UPDATED",
          reason: input.resolution ?? null,
          before: {
            status: existing.status,
            priority: existing.priority,
            assignedToUserId: existing.assignedToUserId,
            resolution: existing.resolution,
          },
          after: {
            status: updated.status,
            priority: updated.priority,
            assignedToUserId: updated.assignedToUserId,
            resolution: updated.resolution,
          },
        });
        return updated;
      });
    },
  };
}
