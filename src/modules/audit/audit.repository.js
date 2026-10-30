export function createAuditRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    async list({ entityType, entityId, action, actorUserId, page, limit }) {
      const where = {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(action ? { action } : {}),
        ...(actorUserId ? { actorUserId } : {}),
      };
      const [items, total] = await Promise.all([
        prismaClient.operationalAuditEvent.findMany({
          where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit, take: limit,
          select: {
            id: true, actorUserId: true, entityType: true, entityId: true,
            action: true, reason: true, before: true, after: true, metadata: true, createdAt: true,
            actor: { select: { id: true, fullName: true, email: true } },
          },
        }),
        prismaClient.operationalAuditEvent.count({ where }),
      ]);
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },
  };
}
