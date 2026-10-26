export function createAuthSessionsRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    create(data) { return prismaClient.authSession.create({ data }); },
    findByHash(refreshTokenHash) { return prismaClient.authSession.findUnique({ where: { refreshTokenHash }, include: { user: true } }); },
    async rotate({ currentId, currentHash, next }) {
      return prismaClient.$transaction(async (tx) => {
        const changed = await tx.authSession.updateMany({
          where: { id: currentId, refreshTokenHash: currentHash, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { revokedAt: new Date(), lastUsedAt: new Date() },
        });
        if (changed.count !== 1) return null;
        return tx.authSession.create({ data: { ...next, rotatedFromId: currentId } });
      });
    },
    revokeByHash(refreshTokenHash, userId) {
      return prismaClient.authSession.updateMany({
        where: { refreshTokenHash, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    findActiveById(id, userId) {
      return prismaClient.authSession.findFirst({ where: { id, userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    },
  };
}
