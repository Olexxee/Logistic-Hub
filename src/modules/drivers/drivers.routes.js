import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
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

const idSchema = z.string().trim().min(1).max(128);

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

export function createDriversRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createDriversService({ prismaClient });
  const requireAdmin = requireRole("ADMIN");
  const requireDriver = requireRole("DRIVER");

  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      const profile = await service.getMyProfile(req.user.id);
      return res.status(200).json({ success: true, data: { profile } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/onboarding", requireAuth, async (req, res, next) => {
    const parsed = driverOnboardingSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const profile = await service.submitOnboarding({ user: req.user, input: parsed.data });
      return res.status(201).json({ success: true, data: profile });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/availability", requireAuth, requireDriver, async (req, res, next) => {
    const parsed = driverAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.setAvailability({ userId: req.user.id, input: parsed.data });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/location", requireAuth, requireDriver, async (req, res, next) => {
    const parsed = driverLocationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.recordLocation({ userId: req.user.id, input: parsed.data });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/admin/:driverProfileId/verification", requireAuth, requireAdmin, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.driverProfileId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = driverVerificationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.reviewDriver({ driverProfileId: parsedId.data, verificationStatus: parsed.data.verificationStatus });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/admin/vehicles/:vehicleId/verification", requireAuth, requireAdmin, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.vehicleId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = vehicleVerificationSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    try {
      const result = await service.reviewVehicle({ vehicleId: parsedId.data, verificationStatus: parsed.data.verificationStatus });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found." } });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/admin/coverage", requireAuth, requireAdmin, async (req, res, next) => {
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
