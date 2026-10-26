export function createSupportRepository({ prismaClient }) {
  return {
    createTicket(data) { return prismaClient.supportTicket.create({ data }); },
    list({ userId, admin, status, limit }) {
      return prismaClient.supportTicket.findMany({ where: { ...(admin ? {} : { userId }), ...(status ? { status } : {}) }, orderBy: [{ createdAt: "desc" }], take: limit });
    },
    findTicket(id) { return prismaClient.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, fullName: true, role: true } } } } } }); },
    addMessage(data) { return prismaClient.supportMessage.create({ data, include: { author: { select: { id: true, fullName: true, role: true } } }); },
    updateTicket(id, data) { return prismaClient.supportTicket.update({ where: { id }, data }); },
  };
}
