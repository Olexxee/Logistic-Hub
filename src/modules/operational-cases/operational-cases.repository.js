export function createOperationalCasesRepository({ prismaClient }) {
  return {
    transaction(work) { return prismaClient.$transaction(work); },
    list({ status, type, priority, cursor, limit = 25, q, assignedToUserId, unassignedOnly, createdFrom, createdTo }, tx = prismaClient) {
      const search = q?.trim();
      return tx.operationalCase.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          ...(priority ? { priority } : {}),
          ...(assignedToUserId ? { assignedToUserId } : {}),
          ...(unassignedOnly ? { assignedToUserId: null } : {}),
          ...(search ? { OR: [
            { publicReference: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ] } : {}),
          ...(createdFrom || createdTo ? { createdAt: {
            ...(createdFrom ? { gte: createdFrom } : {}),
            ...(createdTo ? { lte: createdTo } : {}),
          } } : {}),
        },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        take: limit + 1,
        select: {
          id: true,
          publicReference: true,
          type: true,
          status: true,
          priority: true,
          title: true,
          description: true,
          resolution: true,
          resolvedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          parcelBooking: { select: { id: true, publicReference: true } },
          deliveryLeg: { select: { id: true, sequence: true, type: true, status: true } },
          custodyHandover: { select: { id: true, status: true, fromPartyType: true, toPartyType: true } },
          partner: { select: { id: true, displayName: true } },
          hubPoint: { select: { id: true, name: true } },
          reportedBy: { select: { id: true, fullName: true } },
          assignedTo: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      });
    },
    findById(id, tx = prismaClient) {
      return tx.operationalCase.findUnique({ where: { id } });
    },
    findAssignee(id, tx = prismaClient) {
      return tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, emailVerifiedAt: true } });
    },
    update(id, data, tx = prismaClient) {
      return tx.operationalCase.update({ where: { id }, data });
    },
    audit(data, tx = prismaClient) {
      return tx.operationalAuditEvent.create({ data });
    },
  };
}
