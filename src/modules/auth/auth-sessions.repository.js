import { prisma } from "../../db/prisma.js";

export function createAuthSessionsRepository(prismaClient = prisma) {
  return {
    create(data) { return prismaClient.authSession.create({ data }); },
    findByTokenHash(tokenHash) { return prismaClient.authSession.findUnique({ where: { tokenHash }, include: { user: true } }); },
    rotate({ id, oldTokenHash, newTokenHash, expiresAt, now }) {
      return prismaClient.$transaction(async (tx) => {
        const changed = await tx.authSession.updateMany({
          where: { id, tokenHash: oldTokenHash, revokedAt: null, expiresAt: { gt: now } },
          data: { tokenHash: newTokenHash, expiresAt, lastUsedAt: now },
        });
        if (changed.count !== 1) return null;
        return tx.authSession.findUnique({ where: { id }, include: { user: true } });
      });
    },
    revoke({ tokenHash, now }) {
      return prismaClient.authSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } });
    },
    revokeAllForUser({ userId, now }) {
      return prismaClient.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    },
  };
}
