import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createDiscoveryService } from "./discovery.service.js";

const id = z.string().trim().min(1).max(128);
const userSearchQuery = z.object({
  q: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["CUSTOMER", "DRIVER", "ADMIN", "SUPPORT", "PARTNER_OPERATOR", "HUB_OPERATOR"]).optional(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const quoteListQuery = z.object({
  status: z.enum(["OFFERED", "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]).optional(),
  partnerId: id.optional(),
  bookingId: id.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const assignmentQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const paymentParams = z.object({ paymentAttemptId: id }).strict();

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR",
    message: "One or more request fields are invalid.",
    details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  } });
}

export function createDiscoveryRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createDiscoveryService({ prismaClient });

  router.get("/driver/assignments/mine", authMiddleware, roleMiddleware("DRIVER"), (req, res, next) => {
    const parsed = assignmentQuery.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(async (req, res) => {
    const data = await service.listDriverAssignments({ userId: req.user.id, ...req.validatedQuery });
    return res.status(200).json({ success: true, data });
  }));

  router.get("/partner/memberships/mine", authMiddleware, asyncWrapper(async (req, res) => {
    const data = await service.listUserPartnerMemberships({ userId: req.user.id });
    return res.status(200).json({ success: true, data });
  }));

  router.get("/hub-operator/memberships/mine", authMiddleware, asyncWrapper(async (req, res) => {
    const data = await service.listUserHubMemberships({ userId: req.user.id });
    return res.status(200).json({ success: true, data });
  }));

  router.get("/admin/users", authMiddleware, roleMiddleware("ADMIN"), (req, res, next) => {
    const parsed = userSearchQuery.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(async (req, res) => {
    const data = await service.searchUsers(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  }));

  router.get("/admin/quotes", authMiddleware, roleMiddleware("ADMIN", "SUPPORT"), (req, res, next) => {
    const parsed = quoteListQuery.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(async (req, res) => {
    const data = await service.listAdminQuotes(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  }));

  router.get("/payments/:paymentAttemptId", authMiddleware, (req, res, next) => {
    const parsed = paymentParams.safeParse(req.params);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    req.validatedParams = parsed.data;
    return next();
  }, asyncWrapper(async (req, res) => {
    const data = await service.getPaymentAttempt({ paymentAttemptId: req.validatedParams.paymentAttemptId, user: req.user });
    if (!data) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Payment attempt not found." } });
    return res.status(200).json({ success: true, data });
  }));

  return router;
}

export const discoveryRouter = createDiscoveryRouter();
