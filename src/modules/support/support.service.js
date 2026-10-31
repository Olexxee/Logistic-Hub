import { randomBytes } from "node:crypto";
import { createSupportRepository } from "./support.repository.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/http/app-error.js";
import { writeOperationalAuditEvent } from "../../shared/audit/operational-audit.js";

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
