import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from "../../shared/http/app-error.js";
import { createSupportRepository } from "./support.repository.js";

const STAFF = new Set(["ADMIN", "SUPPORT"]);
export function createSupportService({ prismaClient, clock = () => new Date() }) {
  const repository = createSupportRepository({ prismaClient });
  async function visibleTicket(ticketId, user) {
    const ticket = await repository.findTicket(ticketId);
    if (!ticket) throw new NotFoundError("Support ticket not found.");
    if (!STAFF.has(user.role) && ticket.userId !== user.id) throw new ForbiddenError("You cannot access this support ticket.");
    return ticket;
  }
  function serialize(ticket, user) {
    const staff = STAFF.has(user.role);
    return { ...ticket, messages: ticket.messages.filter((message) => staff || !message.internal) };
  }
  return {
    async create({ user, input }) {
      if (input.bookingType && !input.bookingId) throw new ValidationError("bookingId is required when bookingType is supplied.");
      return repository.createTicket({ userId: user.id, ...input, status: "OPEN", priority: "NORMAL" });
    },
    async list({ user, status, limit = 50 }) {
      return repository.list({ userId: user.id, admin: STAFF.has(user.role), status, limit });
    },
    async get({ ticketId, user }) { return serialize(await visibleTicket(ticketId, user), user); },
    async reply({ ticketId, user, body, internal = false }) {
      const ticket = await visibleTicket(ticketId, user);
      if (ticket.status === "CLOSED") throw new ConflictError("This support ticket is closed.", "TICKET_CLOSED");
      if (internal && !STAFF.has(user.role)) throw new ForbiddenError("Only support staff can add internal notes.");
      const message = await repository.addMessage({ ticketId, authorId: user.id, body, internal });
      return { id: message.id, ticketId, author: message.author, body: message.body, internal: message.internal, createdAt: message.createdAt };
    },
    async update({ ticketId, user, status, priority, assignedAdminId }) {
      if (!STAFF.has(user.role)) throw new ForbiddenError("Only support staff can update ticket status.");
      await visibleTicket(ticketId, user);
      const data = {
        ...(status ? { status, ...(status === "CLOSED" ? { closedAt: clock() } : { closedAt: null }) } : {}),
        ...(priority ? { priority } : {}),
        ...(assignedAdminId !== undefined ? { assignedAdminId } : {}),
      };
      return repository.updateTicket(ticketId, data);
    },
  };
}
