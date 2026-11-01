import { prisma } from "../../db/prisma.js";

export function createSupportRepository(prismaClient = prisma) {
  return {
    findOwnedBooking({ bookingType, bookingId, userId }) {
      if (bookingType === "PARCEL") {
        return prismaClient.parcelBooking.findFirst({ where: { id: bookingId, senderId: userId }, select: { id: true } });
      }
      if (bookingType === "RIDE") {
        return prismaClient.rideBooking.findFirst({ where: { id: bookingId, passengerId: userId }, select: { id: true } });
      }
      return null;
    },
    createTicket(data) {
      return prismaClient.supportTicket.create({ data: {
        ...data,
        ...(data.bookingType === "PARCEL" && data.bookingId ? { parcelBookingId: data.bookingId } : {}),
        ...(data.bookingType === "RIDE" && data.bookingId ? { rideBookingId: data.bookingId } : {}),
      } });
    },
    listMine({ customerId, cursor, limit }) {
      return prismaClient.supportTicket.findMany({
        where: { customerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    },
    listAdmin({ status, category, priority, assignedToUserId, unassignedOnly, q, cursor, limit }) {
      const where = {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(priority ? { priority } : {}),
        ...(unassignedOnly ? { assignedToUserId: null } : assignedToUserId ? { assignedToUserId } : {}),
        ...(q ? {
          OR: [
            { publicReference: { contains: q, mode: "insensitive" } },
            { subject: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
      };
      return prismaClient.supportTicket.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    },
    findById(id, client = prismaClient) {
      return client.supportTicket.findUnique({ where: { id } });
    },
    listMessages({ ticketId, includeInternal }) {
      return prismaClient.supportTicketMessage.findMany({
        where: { ticketId, ...(includeInternal ? {} : { visibility: "PUBLIC" }) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true, ticketId: true, visibility: true, body: true, createdAt: true,
          author: { select: { id: true, fullName: true, role: true } },
        },
      });
    },
    createMessage({ ticketId, authorId, visibility, body }, client = prismaClient) {
      return client.supportTicketMessage.create({
        data: { ticketId, authorId, visibility, body },
        select: {
          id: true, ticketId: true, visibility: true, body: true, createdAt: true,
          author: { select: { id: true, fullName: true, role: true } },
        },
      });
    },
    updateTicket({ id, data, now }) {
      const terminal = ["RESOLVED", "CLOSED"].includes(data.status);
      return prismaClient.supportTicket.update({
        where: { id },
        data: {
          ...data,
          ...(data.status !== undefined ? { resolvedAt: terminal ? now : null } : {}),
        },
      });
    },
  };
}
