import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { emailService } from "../../shared/email/email.service.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  driverAvailabilitySchema,
  driverCoverageSchema,
  driverLocationSchema,
  driverOnboardingSchema,
  driverVerificationSchema,
  vehicleVerificationSchema,
} from "./drivers.schemas.js";
import { createDriversService } from "./drivers.service.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createDriversAdminRouter } from "./drivers.admin.routes.js";
import { createDriverDocumentsRouter } from "./driver-documents.routes.js";

const idSchema = z.string().trim().min(1).max(128);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "One or more fields are invalid.",
      details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
    },
  });
}

export function createDriversRouter({ prismaClient = prisma, email = emailService, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createDriversService({ prismaClient });
  const requireAdmin = roleMiddleware("ADMIN");
  const requireDriver = roleMiddleware("DRIVER");
  router.use("/admin", createDriversAdminRouter({ prismaClient, authMiddleware, roleMiddleware }));
  router.use(createDriverDocumentsRouter({ prismaClient, authMiddleware, roleMiddleware }));

  router.get("/me", authMiddleware, async (req, res, next) => {
    try {
      const profile = await service.getMyProfile(req.user.id);
      return res.status(200).json({ success: true, data: { profile } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/onboarding", authMiddleware, async (req, res, next) => {
    const parsed = driverOnboardingSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const profile = await service.submitOnboarding({ user: req.user, input: parsed.data });
      return res.status(201).json({ success: true, data: profile });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/me/reapply", authMiddleware, asyncWrapper(async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().min(10).max(500) }).strict().safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const result = await service.reapply({ userId: req.user.id, reason: parsed.data.reason });
    if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
    return res.status(200).json({ success: true, data: result });
  }));

  router.patch("/availability", authMiddleware, requireDriver, async (req, res, next) => {
    const parsed = driverAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.setAvailability({ userId: req.user.id, input: parsed.data });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/location", authMiddleware, requireDriver, async (req, res, next) => {
    const parsed = driverLocationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.recordLocation({ userId: req.user.id, input: parsed.data });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/admin/:driverProfileId/verification", authMiddleware, requireAdmin, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.driverProfileId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = driverVerificationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.reviewDriver({ driverProfileId: parsedId.data, verificationStatus: parsed.data.verificationStatus, reason: parsed.data.reason, actorUserId: req.user.id });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
      let emailStatus = "not_sent";
      if (email.configured && result.userId) {
        const account = await prismaClient.user.findUnique({ where: { id: result.userId }, select: { fullName: true, email: true } });
        if (account?.email) {
          try {
            const approved = result.verificationStatus === "VERIFIED";
            const safeName = escapeHtml(account.fullName);
            await email.send({
              to: account.email,
              subject: approved ? "Your Logistic Hub driver profile is verified" : "Update on your Logistic Hub driver application",
              text: approved
                ? `Hello ${account.fullName}, your driver profile has been verified. You can go online when your vehicle and service coverage are eligible.`
                : `Hello ${account.fullName}, your driver application was not approved. Please contact support if you need clarification.`,
              html: approved
                ? `<p>Hello ${safeName},</p><p>Your driver profile has been verified. You can go online when your vehicle and service coverage are eligible.</p>`
                : `<p>Hello ${safeName},</p><p>Your driver application was not approved. Please contact support if you need clarification.</p>`,
              idempotencyKey: `driver-verification-${result.id}-${result.verificationStatus.toLowerCase()}`,
              tags: [{ name: "category", value: "driver-verification" }],
            });
            emailStatus = "sent";
          } catch {
            emailStatus = "failed";
          }
        }
      }
      const { userId: _userId, ...publicResult } = result;
      return res.status(200).json({ success: true, data: { ...publicResult, emailStatus } });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/admin/vehicles/:vehicleId/verification", authMiddleware, requireAdmin, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.vehicleId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = vehicleVerificationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.reviewVehicle({ vehicleId: parsedId.data, verificationStatus: parsed.data.verificationStatus, reason: parsed.data.reason, actorUserId: req.user.id });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found." } });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/admin/coverage", authMiddleware, requireAdmin, async (req, res, next) => {
    const parsed = driverCoverageSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.setCoverage(parsed.data);
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile or service zone not found." } });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const driversRouter = createDriversRouter();
