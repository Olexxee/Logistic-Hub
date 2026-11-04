export function createHubOperatorsAdminRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    findHub(hubPointId, tx = prismaClient) {
      return tx.hubPoint.findUnique({ where: { id: hubPointId }, select: { id: true, name: true, status: true } });
    },
    findUser(userId, tx = prismaClient) {
      return tx.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, email: true, phone: true, status: true, emailVerifiedAt: true } });
    },
    findMembership(hubPointId, userId, tx = prismaClient) {
      return tx.hubPointOperator.findUnique({ where: { hubPointId_userId: { hubPointId, userId } } });
    },
    findMember(hubPointId, memberId, tx = prismaClient) {
      return tx.hubPointOperator.findFirst({ where: { id: memberId, hubPointId } });
    },
    listMembers(hubPointId, { where, skip, take }, tx = prismaClient) {
      return tx.hubPointOperator.findMany({
        where: { hubPointId, ...where },
        skip, take, orderBy: [{ role: "asc" }, { createdAt: "desc" }],
        select: {
          id: true, hubPointId: true, userId: true, role: true, isActive: true, canDispatch: true, createdAt: true, updatedAt: true,
          user: { select: { id: true, fullName: true, email: true, phone: true, status: true, emailVerifiedAt: true } },
        },
      });
    },
    countMembers(hubPointId, where, tx = prismaClient) {
      return tx.hubPointOperator.count({ where: { hubPointId, ...where } });
    },
    upsertMember({ hubPointId, userId, role, canDispatch }, tx) {
      return tx.hubPointOperator.upsert({
        where: { hubPointId_userId: { hubPointId, userId } },
        create: { hubPointId, userId, role, canDispatch, isActive: true },
        update: { role, canDispatch, isActive: true },
      });
    },
    updateMember(memberId, data, tx) {
      return tx.hubPointOperator.update({ where: { id: memberId }, data });
    },
  };
}
