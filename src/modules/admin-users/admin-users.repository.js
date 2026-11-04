export function createAdminUsersRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    transaction(work) {
      return prismaClient.$transaction(work);
    },
    listUsers({ search, role, status, skip, take }) {
      const where = {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ] } : {}),
      };
      return prismaClient.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: { id: true, fullName: true, email: true, role: true, status: true, emailVerifiedAt: true, createdAt: true },
      });
    },
    countUsers({ search, role, status }) {
      const where = {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ] } : {}),
      };
      return prismaClient.user.count({ where });
    },
    findUser(userId, tx = prismaClient) {
      return tx.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, email: true, role: true, status: true, emailVerifiedAt: true },
      });
    },
    updateUserStatus(userId, status, tx = prismaClient) {
      return tx.user.update({ where: { id: userId }, data: { status } });
    },
    countActiveSessions(userId, now, tx = prismaClient) {
      return tx.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } });
    },
    revokeActiveSessions(userId, now, tx = prismaClient) {
      return tx.authSession.updateMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
    },
    createAudit(data, tx = prismaClient) {
      return tx.operationalAuditEvent.create({ data });
    },
  };
}
