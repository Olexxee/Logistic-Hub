export function createAuthSessionRepository({ prismaClient }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");
  return {
    create(data, tx = prismaClient) {
      return tx.authSession.create({ data });
    },
    findActiveByRefreshHash(refreshTokenHash, now = new Date(), tx = prismaClient) {
      return tx.authSession.findFirst({
        where: { refreshTokenHash, revokedAt: null, expiresAt: { gt: now } },
      });
    },
    rotate({ id, oldHash, newHash, expiresAt, now = new Date() }, tx = prismaClient) {
      return tx.authSession.updateMany({
        where: { id, refreshTokenHash: oldHash, revokedAt: null, expiresAt: { gt: now } },
        data: { refreshTokenHash: newHash, expiresAt, lastUsedAt: now },
      });
    },
    revoke({ id, userId, now = new Date() }, tx = prismaClient) {
      return tx.authSession.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
    revokeAll({ userId, now = new Date() }, tx = prismaClient) {
      return tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
    findById(id, tx = prismaClient) {
      return tx.authSession.findUnique({ where: { id } });
    },
  };
}
