import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { createOutboxService } from "../../shared/jobs/outbox.service.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from "./auth.crypto.js";
import { createAuthMiddleware } from "./auth.middleware.js";
import { createAuthSessionsService } from "./auth-sessions.service.js";
import { createWorkspaceResolver } from "./workspace-resolver.service.js";
import { createPersistentRateLimit } from "../../shared/http/rate-limit.middleware.js";

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
}).strict();

const emailTokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();
const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict();
const resetPasswordSchema = emailTokenSchema.extend({ password: z.string().min(10).max(128) }).strict();
const REFRESH_COOKIE_NAME = env.NODE_ENV === "production" ? "__Host-lh_refresh" : "lh_refresh";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS,
  };
}

function readRefreshCookie(req) {
  const header = req.headers.cookie ?? "";
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));
  return pair ? pair.slice(REFRESH_COOKIE_NAME.length + 1) : null;
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

function requireTrustedBrowserRequest(req, res, next) {
  const origins = env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  const origin = req.get("origin");
  if (!origin || !origins.includes(origin) || req.get("x-auth-csrf") !== "1") {
    return res.status(403).json({
      success: false,
      error: { code: "CSRF_VALIDATION_FAILED", message: "The browser request could not be verified." },
    });
  }
  return next();
}

const DUMMY_PASSWORD_HASH = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128);

const genericValidationError = (res, issues) => res.status(400).json({
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "One or more fields are invalid.",
    details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
  },
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function emailActionUrl(path, token, baseUrl = env.APP_BASE_URL) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function maskEmail(address) {
  if (typeof address !== "string") return "unknown";
  const [local, domain] = address.split("@");
  if (!local || !domain) return "unknown";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function createAuthRouter({
  prismaClient = prisma,
  secret = env.JWT_ACCESS_SECRET,
  appBaseUrl = env.APP_BASE_URL,
} = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const { requireAuth } = createAuthMiddleware({ prismaClient, secret });
  const authRateLimit = createPersistentRateLimit({ prismaClient, namespace: "auth-write", limit: 10, windowMs: 15 * 60_000 });
  const refreshRateLimit = createPersistentRateLimit({ prismaClient, namespace: "auth-refresh", limit: 30, windowMs: 15 * 60_000 });
  const sessions = createAuthSessionsService({ prismaClient, secret });
  const workspaceResolver = createWorkspaceResolver({ prismaClient });
  const outbox = createOutboxService({ prismaClient });

  router.post("/register", authRateLimit, async (req, res, next) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return genericValidationError(res, parsed.error.issues);
    const { fullName, email: address, password } = parsed.data;
    try {
      const existing = await prismaClient.user.findUnique({ where: { email: address }, select: { id: true } });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists." },
        });
      }

      const passwordHash = await hashPassword(password);
      const rawToken = createOpaqueToken();
      const verificationUrl = emailActionUrl("/verify-email", rawToken, appBaseUrl);
      const registration = await prismaClient.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { fullName, email: address, passwordHash, role: "CUSTOMER", status: "PENDING" },
          select: { id: true, fullName: true, email: true },
        });
        const actionToken = await tx.authActionToken.create({
          data: { userId: user.id, purpose: "EMAIL_VERIFICATION", tokenHash: hashOpaqueToken(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
          select: { id: true },
        });
        await outbox.enqueueEmailInTransaction(tx, {
          to: address,
          subject: "Verify your Logistic Hub account",
          html: "<p>Hello " + escapeHtml(fullName) + ",</p><p>Verify your email to activate your Logistic Hub account.</p><p><a href=\"" + verificationUrl + "\">Verify email address</a></p><p>This link expires in 24 hours.</p>",
          text: "Hello " + fullName + ", verify your Logistic Hub account using this link: " + verificationUrl + ". This link expires in 24 hours.",
          tags: [{ name: "category", value: "account-verification" }],
        }, "auth-email-verification-" + actionToken.id);
        return user;
      });

      req.log?.info?.({
        event: "email.verification.queued",
        recipient: maskEmail(registration.email),
        userId: registration.id,
      }, "Verification email queued");

      return res.status(201).json({
        success: true,
        data: { message: "Check your email to verify your account.", email: registration.email },
      });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({
          success: false,
          error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists." },
        });
      }
      return next(error);
    }
  });

  router.post("/verify-email", async (req, res, next) => {
    const parsed = emailTokenSchema.safeParse(req.body);
    if (!parsed.success) return genericValidationError(res, parsed.error.issues);
    const tokenHash = hashOpaqueToken(parsed.data.token);
    const now = new Date();

    try {
      const token = await prismaClient.authActionToken.findFirst({
        where: {
          tokenHash,
          purpose: "EMAIL_VERIFICATION",
          consumedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, userId: true },
      });
      if (!token) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_OR_EXPIRED_TOKEN", message: "The verification link is invalid or has expired." },
        });
      }

      const consumed = await prismaClient.$transaction(async (tx) => {
        const update = await tx.authActionToken.updateMany({
          where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (update.count !== 1) return false;
        await tx.user.update({
          where: { id: token.userId },
          data: { emailVerifiedAt: now, status: "ACTIVE" },
        });
        return true;
      });
      if (!consumed) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_OR_EXPIRED_TOKEN", message: "The verification link is invalid or has expired." },
        });
      }

      return res.status(200).json({ success: true, data: { message: "Email verified. You can now sign in." } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/verify-email/resend", authRateLimit, async (req, res, next) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return genericValidationError(res, parsed.error.issues);

    try {
      const user = await prismaClient.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, fullName: true, email: true, status: true, emailVerifiedAt: true },
      });

      // Keep the response identical for unknown, active, and pending accounts.
      if (user && user.status !== "ACTIVE" && !user.emailVerifiedAt) {
        const rawToken = createOpaqueToken();
        const verificationUrl = emailActionUrl("/verify-email", rawToken, appBaseUrl);
        await prismaClient.$transaction(async (tx) => {
          await tx.authActionToken.updateMany({
            where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
            data: { consumedAt: new Date() },
          });
          const actionToken = await tx.authActionToken.create({
            data: {
              userId: user.id,
              purpose: "EMAIL_VERIFICATION",
              tokenHash: hashOpaqueToken(rawToken),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            select: { id: true },
          });
          await outbox.enqueueEmailInTransaction(tx, {
            to: user.email,
            subject: "Verify your Logistic Hub account",
            html: "<p>Hello " + escapeHtml(user.fullName) + ",</p><p>Verify your email to activate your Logistic Hub account.</p><p><a href=\"" + verificationUrl + "\">Verify email address</a></p><p>This link expires in 24 hours.</p>",
            text: "Hello " + user.fullName + ", verify your Logistic Hub account using this link: " + verificationUrl + ". This link expires in 24 hours.",
            tags: [{ name: "category", value: "account-verification" }],
          }, "auth-email-verification-" + actionToken.id);
        });
        req.log?.info?.({
          event: "email.verification.resent.queued",
          recipient: maskEmail(user.email),
          userId: user.id,
        }, "Verification email resend queued");
      }

      return res.status(202).json({
        success: true,
        data: { message: "If an unverified account exists for that email, a verification email will be sent." },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/login", requireTrustedBrowserRequest, authRateLimit, async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return genericValidationError(res, parsed.error.issues);

    if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
      return res.status(503).json({
        success: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured for this environment." },
      });
    }

    try {
      const user = await prismaClient.user.findUnique({ where: { email: parsed.data.email } });
      const passwordMatches = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !passwordMatches) {
        return res.status(401).json({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." },
        });
      }
      if (user.status !== "ACTIVE" || !user.emailVerifiedAt) {
        return res.status(403).json({
          success: false,
          error: { code: "ACCOUNT_NOT_ACTIVE", message: "Verify your email before signing in." },
        });
      }
      const sessionTokens = await sessions.issue(user, { userAgent: req.get("user-agent"), ipHash: hashOpaqueToken(req.ip ?? req.socket?.remoteAddress ?? "unknown") });
      setRefreshCookie(res, sessionTokens.refreshToken);
      const { refreshToken: _refreshToken, refreshExpiresAt: _refreshExpiresAt, ...publicTokens } = sessionTokens;
      const workspace = await workspaceResolver.resolve(user);
      return res.status(200).json({
        success: true,
        data: {
          ...publicTokens,
          user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, workspace },
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/password/forgot", authRateLimit, async (req, res, next) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return genericValidationError(res, parsed.error.issues);

    try {
      const user = await prismaClient.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, fullName: true, email: true, status: true },
      });
      if (user?.email && user.status === "ACTIVE") {
        const rawToken = createOpaqueToken();
        const resetUrl = emailActionUrl("/reset-password", rawToken, appBaseUrl);
        await prismaClient.$transaction(async (tx) => {
          const actionToken = await tx.authActionToken.create({
            data: { userId: user.id, purpose: "PASSWORD_RESET", tokenHash: hashOpaqueToken(rawToken), expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
            select: { id: true },
          });
          await outbox.enqueueEmailInTransaction(tx, {
            to: user.email,
            subject: "Reset your Logistic Hub password",
            html: "<p>Hello " + escapeHtml(user.fullName) + ",</p><p>Use the link below to reset your password.</p><p><a href=\"" + resetUrl + "\">Reset password</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>",
            text: "Reset your Logistic Hub password using this link: " + resetUrl + ". This link expires in 30 minutes.",
            tags: [{ name: "category", value: "password-reset" }],
          }, "auth-password-reset-" + actionToken.id);
        });
        req.log?.info?.({
          event: "email.password-reset.queued",
          recipient: maskEmail(user.email),
          userId: user.id,
        }, "Password reset email queued");
      }
      return res.status(202).json({
        success: true,
        data: { message: "If an active account exists for that email, password reset instructions will be sent." },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/password/reset", authRateLimit, async (req, res, next) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return genericValidationError(res, parsed.error.issues);
    const tokenHash = hashOpaqueToken(parsed.data.token);
    const now = new Date();

    try {
      const token = await prismaClient.authActionToken.findFirst({
        where: {
          tokenHash,
          purpose: "PASSWORD_RESET",
          consumedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, userId: true },
      });
      if (!token) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_OR_EXPIRED_TOKEN", message: "The reset link is invalid or has expired." },
        });
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const reset = await prismaClient.$transaction(async (tx) => {
        const update = await tx.authActionToken.updateMany({
          where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (update.count !== 1) return false;
        await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
        await tx.authSession.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: now } });
        await tx.authActionToken.updateMany({
          where: { userId: token.userId, purpose: "PASSWORD_RESET", consumedAt: null },
          data: { consumedAt: now },
        });
        return true;
      });
      if (!reset) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_OR_EXPIRED_TOKEN", message: "The reset link is invalid or has expired." },
        });
      }

      await sessions.revokeAllForUser(token.userId);
      return res.status(200).json({ success: true, data: { message: "Password reset successfully. Please sign in again." } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/refresh", requireTrustedBrowserRequest, refreshRateLimit, async (req, res, next) => {
    try {
      const refreshToken = readRefreshCookie(req);
      const tokens = await sessions.refresh(refreshToken);
      setRefreshCookie(res, tokens.refreshToken);
      const { refreshToken: _refreshToken, refreshExpiresAt: _refreshExpiresAt, ...publicTokens } = tokens;
      return res.status(200).json({ success: true, data: publicTokens });
    } catch (error) {
      if (["INVALID_REFRESH_TOKEN", "UNAUTHORIZED"].includes(error.code)) clearRefreshCookie(res);
      return next(error);
    }
  });

  router.post("/logout", requireTrustedBrowserRequest, requireAuth, async (req, res, next) => {
    try {
      await sessions.revokeSession({ sessionId: req.auth.sessionId, userId: req.user.id });
      clearRefreshCookie(res);
      return res.status(200).json({ success: true, data: { message: "Session revoked." } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/logout-all", requireTrustedBrowserRequest, requireAuth, async (req, res, next) => {
    try {
      await sessions.revokeAllForUser(req.user.id);
      clearRefreshCookie(res);
      return res.status(200).json({ success: true, data: { message: "All sessions revoked." } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", requireAuth, async (req, res) => {
    const workspace = await workspaceResolver.resolve(req.user);
    return res.status(200).json({
      success: true,
      data: {
        id: req.user.id,
        fullName: req.user.fullName,
        email: req.user.email,
        role: req.user.role,
        workspace,
      },
    });
  });

  return router;
}

export const authRouter = createAuthRouter();
