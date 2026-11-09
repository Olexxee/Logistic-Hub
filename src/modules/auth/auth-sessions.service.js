import { createOpaqueToken, hashOpaqueToken, signAccessToken } from "./auth.crypto.js";
import { createAuthSessionsRepository } from "./auth-sessions.repository.js";
import { AuthenticationError, ForbiddenError } from "../../shared/http/app-error.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthSessionsService({ prismaClient, secret, clock = () => new Date() }) {
  const repository = createAuthSessionsRepository(prismaClient);
  return {
    async issue(user, metadata = {}) {
      if (user.status !== "ACTIVE" || !user.emailVerifiedAt) throw new ForbiddenError("Verify your email before using a session.", "ACCOUNT_NOT_ACTIVE");
      const raw = createOpaqueToken();
      const now = clock();
      const row = await repository.create({ userId: user.id, tokenHash: hashOpaqueToken(raw), expiresAt: new Date(now.getTime() + REFRESH_TTL_MS), lastUsedAt: now, userAgent: metadata.userAgent?.slice(0, 512) ?? null, ipHash: metadata.ipHash ?? null });
      const access = signAccessToken({ userId: user.id, role: user.role, sessionId: row.id, secret, now: now.getTime() });
      return { refreshToken: raw, refreshExpiresAt: row.expiresAt, accessToken: access.token, tokenType: "Bearer", expiresIn: access.expiresIn };
    },
    async refresh(rawToken) {
      if (typeof rawToken !== "string" || !/^[a-f0-9]{64}$/i.test(rawToken)) throw new AuthenticationError("Refresh token is invalid or expired.", "INVALID_REFRESH_TOKEN");
      const oldHash = hashOpaqueToken(rawToken);
      const session = await repository.findByTokenHash(oldHash);
      const now = clock();
      if (!session || session.revokedAt || session.expiresAt <= now || session.user.status !== "ACTIVE" || !session.user.emailVerifiedAt) {
        throw new AuthenticationError("Refresh token is invalid or expired.", "INVALID_REFRESH_TOKEN");
      }
      const rawNext = createOpaqueToken();
      const rotated = await repository.rotate({ id: session.id, oldTokenHash: oldHash, newTokenHash: hashOpaqueToken(rawNext), expiresAt: new Date(now.getTime() + REFRESH_TTL_MS), now });
      if (!rotated) throw new AuthenticationError("Refresh token has already been used or revoked.", "INVALID_REFRESH_TOKEN");
      const access = signAccessToken({ userId: rotated.user.id, role: rotated.user.role, sessionId: rotated.id, secret, now: now.getTime() });
      return {
        refreshToken: rawNext,
        refreshExpiresAt: rotated.expiresAt,
        accessToken: access.token,
        tokenType: "Bearer",
        expiresIn: access.expiresIn,
        user: {
          id: rotated.user.id,
          fullName: rotated.user.fullName,
          email: rotated.user.email,
          role: rotated.user.role,
          status: rotated.user.status,
        },
      };
    },
    async revoke(rawToken) {
      if (typeof rawToken !== "string" || !/^[a-f0-9]{64}$/i.test(rawToken)) return { revoked: false };
      const result = await repository.revoke({ tokenHash: hashOpaqueToken(rawToken), now: clock() });
      return { revoked: result.count > 0 };
    },
    async revokeSession({ sessionId, userId }) {
      if (!sessionId || !userId) return { revoked: false };
      const result = await repository.revokeById({ id: sessionId, userId, now: clock() });
      return { revoked: result.count > 0 };
    },
    revokeAllForUser(userId) { return repository.revokeAllForUser({ userId, now: clock() }).then((result) => ({ revokedCount: result.count })); },
  };
}
