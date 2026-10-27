import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { verifyAccessToken } from "./auth.crypto.js";

export function createAuthMiddleware({ prismaClient = prisma, secret = env.JWT_ACCESS_SECRET } = {}) {
  async function requireAuth(req, res, next) {
    if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
      return res.status(503).json({
        success: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured for this environment." },
      });
    }

    const authorization = req.get("authorization") ?? "";
    const match = authorization.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "A valid bearer access token is required." },
      });
    }

    const claims = verifyAccessToken(match[1], secret);
    if (!claims) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "The access token is invalid or expired." },
      });
    }

    try {
      const user = await prismaClient.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, fullName: true, email: true, role: true, status: true, emailVerifiedAt: true },
      });
      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "The account is not active." },
        });
      }
      if (claims.sid) {
        const session = await prismaClient.authSession.findFirst({
          where: { id: claims.sid, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        });
        if (!session) {
          return res.status(401).json({
            success: false,
            error: { code: "SESSION_REVOKED", message: "The session is no longer active. Please sign in again." },
          });
        }
      }
      req.user = user;
      req.auth = { userId: user.id, role: user.role, sessionId: claims.sid ?? null };
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." },
        });
      }
      return next();
    };
  }

  return { requireAuth, requireRole };
}

export const { requireAuth, requireRole } = createAuthMiddleware();
