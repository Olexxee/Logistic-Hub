import { createOpaqueToken, hashOpaqueToken, signAccessToken } from "./auth.crypto.js";
import { createAuthSessionsRepository } from "./auth-sessions.repository.js";
import { UnauthorizedError } from "../../shared/http/app-error.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthSessionsService({ prismaClient, secret, clock = () => new Date() }) {
  const repository = createAuthSessionsRepository({ prismaClient });
  function accessFor(user, sessionId) {
    const access = signAccessToken({ userId: user.id, role: user.role, secret, sessionId, now: clock().getTime() });
    return { accessToken: access.token, tokenType: "Bearer", expiresIn: access.expiresIn };
  }
  function sessionData(userId, refreshToken) {
    return { userId, refreshTokenHash: hashOpaqueToken(refreshToken), expiresAt: new Date(clock().getTime() + REFRESH_TTL_MS) };
  }
  return {
    async createForUser(user) {
      const refreshToken = createOpaqueToken();
      const session = await repository.create(sessionData(user.id, refreshToken));
      return { ...accessFor(user, session.id), refreshToken, refreshExpiresAt: session.expiresAt };
    },
    async refresh(refreshToken) {
      if (typeof refreshToken !== "string" || !/^[a-f0-9]{64}$/i.test(refreshToken)) throw new UnauthorizedError("The refresh token is invalid or expired.");
      const hash = hashOpaqueToken(refreshToken);
      const existing = await repository.findByHash(hash);
      const now = clock();
      if (!existing || existing.revokedAt || existing.expiresAt <= now || existing.user.status !== "ACTIVE" || !existing.user.emailVerifiedAt) {
        throw new UnauthorizedError("The refresh token is invalid or expired.");
      }
      const nextRefreshToken = createOpaqueToken();
      const nextSession = await repository.rotate({
        currentId: existing.id,
        currentHash: hash,
        next: sessionData(existing.userId, nextRefreshToken),
      });
      if (!nextSession) throw new UnauthorizedError("The refresh token has already been used or revoked.");
      return { ...accessFor(existing.user, nextSession.id), refreshToken: nextRefreshToken, refreshExpiresAt: nextSession.expiresAt };
    },
    async revoke({ refreshToken, userId }) {
      if (typeof refreshToken !== "string" || !/^[a-f0-9]{64}$/i.test(refreshToken)) return { revoked: false };
      const result = await repository.revokeByHash(hashOpaqueToken(refreshToken), userId);
      return { revoked: result.count > 0 };
    },
    async isSessionActive(sessionId, userId) {
      if (!sessionId) return true;
      return Boolean(await repository.findActiveById(sessionId, userId));
    },
  };
}
