import { createOpaqueToken, hashOpaqueToken, signAccessToken } from "./auth.crypto.js";
import { AuthenticationError } from "../../shared/http/app-error.js";
import { createAuthSessionRepository } from "./auth-session.repository.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthSessionService({ prismaClient, repository = createAuthSessionRepository({ prismaClient }), secret, clock = () => new Date() }) {

  async function issue(user, metadata = {}) {
    const refreshToken = createOpaqueToken();
    const expiresAt = new Date(clock().getTime() + REFRESH_TTL_MS);
    const session = await repository.create({
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt,
      userAgent: metadata.userAgent?.slice(0, 512) ?? null,
      ipHash: metadata.ipHash ?? null,
    });
    const access = signAccessToken({ userId: user.id, role: user.role, sessionId: session.id, secret });
    return {
      accessToken: access.token,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: access.expiresIn,
      refreshExpiresAt: expiresAt,
    };
  }

  async function refresh(rawToken) {
    if (typeof rawToken !== "string" || !/^[a-f0-9]{64}$/i.test(rawToken)) {
      throw new AuthenticationError("The refresh token is invalid or expired.", "UNAUTHORIZED");
    }
    const now = clock();
    const oldHash = hashOpaqueToken(rawToken);
    const session = await repository.findActiveByRefreshHash(oldHash, now);
    if (!session) throw new AuthenticationError("The refresh token is invalid or expired.", "UNAUTHORIZED");
    const user = await repository.findUserForSession(session.userId);
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
      await repository.revoke({ id: session.id, userId: session.userId, now });
      throw new AuthenticationError("The account is not active.", "UNAUTHORIZED");
    }
    const newRaw = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    const rotated = await repository.rotate({
      id: session.id,
      oldHash,
      newHash: hashOpaqueToken(newRaw),
      expiresAt,
      now,
    });
    if (rotated.count !== 1) throw new AuthenticationError("The refresh token has already been used.", "UNAUTHORIZED");
    const access = signAccessToken({ userId: user.id, role: user.role, sessionId: session.id, secret });
    return {
      accessToken: access.token,
      refreshToken: newRaw,
      tokenType: "Bearer",
      expiresIn: access.expiresIn,
      refreshExpiresAt: expiresAt,
    };
  }

  async function revoke({ sessionId, userId }) {
    if (!sessionId || !userId) return false;
    const result = await repository.revoke({ id: sessionId, userId, now: clock() });
    return result.count === 1;
  }

  async function revokeAll(userId) {
    await repository.revokeAll({ userId, now: clock() });
  }

  return { issue, refresh, revoke, revokeAll };
}
