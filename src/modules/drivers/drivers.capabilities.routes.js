import { Router } from "express";
import { z } from "zod";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createDriverCapabilitiesService } from "./drivers.capabilities.service.js";

const capabilities = ["LOCAL_DISPATCH", "PICKUP_COLLECTION", "FINAL_MILE_DELIVERY"];
const capabilitySchema = z.enum(capabilities);
const idSchema = z.string().trim().min(1).max(128);
const requestSchema = z.object({ capability: capabilitySchema }).strict();
const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "SUSPENDED", "REVOKED"]),
  reason: z.string().trim().min(10).max(500),
}).strict();

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR",
    message: "One or more request fields are invalid.",
    details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
  } });
}
function parseParams(res, params, includeVehicle = false) {
  const schema = includeVehicle
    ? z.object({ vehicleId: idSchema }).strict()
    : z.object({ driverProfileId: idSchema }).strict();
  const parsed = schema.safeParse(params);
  return parsed.success ? parsed.data : (invalid(res, parsed.error.issues), null);
}
function parseCapability(res, value) {
  const parsed = capabilitySchema.safeParse(value);
  return parsed.success ? parsed.data : (invalid(res, parsed.error.issues), null);
}

export function createDriverCapabilitiesRouter({ prismaClient, authMiddleware, roleMiddleware }) {
  const router = Router();
  const service = createDriverCapabilitiesService({ prismaClient });
  const requireDriver = roleMiddleware("DRIVER");
  const requireAdmin = roleMiddleware("ADMIN");

  router.get("/me/capabilities", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const items = await service.listMyDriverCapabilities(req.user.id);
    if (!items) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
    return res.status(200).json({ success: true, data: { items } });
  }));

  router.post("/me/capabilities", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const capability = await service.requestDriverCapability({ userId: req.user.id, capability: parsed.data.capability });
    if (!capability) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
    return res.status(201).json({ success: true, data: capability });
  }));

  router.get("/me/vehicles/:vehicleId/capabilities", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const params = parseParams(res, req.params, true);
    if (!params) return undefined;
    const items = await service.listMyVehicleCapabilities({ userId: req.user.id, vehicleId: params.vehicleId });
    if (!items) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found." } });
    return res.status(200).json({ success: true, data: { items } });
  }));

  router.post("/me/vehicles/:vehicleId/capabilities", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const params = parseParams(res, req.params, true);
    if (!params) return undefined;
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const capability = await service.requestVehicleCapability({ userId: req.user.id, vehicleId: params.vehicleId, capability: parsed.data.capability });
    if (!capability) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found." } });
    return res.status(201).json({ success: true, data: capability });
  }));

  router.get("/admin/drivers/:driverProfileId/capabilities", authMiddleware, requireAdmin, asyncWrapper(async (req, res) => {
    const params = parseParams(res, req.params);
    if (!params) return undefined;
    const items = await service.listDriverCapabilities(params.driverProfileId);
    if (!items) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
    return res.status(200).json({ success: true, data: { items } });
  }));

  router.patch("/admin/drivers/:driverProfileId/capabilities/:capability", authMiddleware, requireAdmin, asyncWrapper(async (req, res) => {
    const params = parseParams(res, req.params);
    if (!params) return undefined;
    const capability = parseCapability(res, req.params.capability);
    if (!capability) return undefined;
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const result = await service.reviewDriverCapability({ ...params, capability, ...parsed.data, actorUserId: req.user.id });
    if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver capability request not found." } });
    return res.status(200).json({ success: true, data: result });
  }));

  router.get("/admin/vehicles/:vehicleId/capabilities", authMiddleware, requireAdmin, asyncWrapper(async (req, res) => {
    const params = parseParams(res, req.params, true);
    if (!params) return undefined;
    const items = await service.listVehicleCapabilities(params.vehicleId);
    if (!items) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle not found." } });
    return res.status(200).json({ success: true, data: { items } });
  }));

  router.patch("/admin/vehicles/:vehicleId/capabilities/:capability", authMiddleware, requireAdmin, asyncWrapper(async (req, res) => {
    const params = parseParams(res, req.params, true);
    if (!params) return undefined;
    const capability = parseCapability(res, req.params.capability);
    if (!capability) return undefined;
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const result = await service.reviewVehicleCapability({ ...params, capability, ...parsed.data, actorUserId: req.user.id });
    if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Vehicle capability request not found." } });
    return res.status(200).json({ success: true, data: result });
  }));

  return router;
}
