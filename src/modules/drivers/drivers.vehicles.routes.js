import { Router } from "express";
import { z } from "zod";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createDriverVehiclesService } from "./drivers.vehicles.service.js";

const idSchema = z.string().trim().min(1).max(128);
const vehicleTypeSchema = z.enum(["BICYCLE", "MOTORCYCLE", "CAR", "VAN", "PICKUP", "TRUCK"]);
const addSchema = z.object({
  type: vehicleTypeSchema,
  make: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  registrationPlate: z.string().trim().min(2).max(32).optional(),
  parcelCapacity: z.string().trim().max(80).optional(),
}).strict();
const updateSchema = z.object({
  type: vehicleTypeSchema.optional(),
  make: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  registrationPlate: z.string().trim().min(2).max(32).nullable().optional(),
  parcelCapacity: z.string().trim().max(80).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: "At least one vehicle field must be supplied." });

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more request fields are invalid.",
    details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
  } });
}

export function createDriverVehiclesRouter({ prismaClient, authMiddleware, roleMiddleware }) {
  const router = Router();
  const service = createDriverVehiclesService({ prismaClient });
  const requireDriver = roleMiddleware("DRIVER");

  router.get("/me/vehicles", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const items = await service.listMine({ userId: req.user.id });
    return res.status(200).json({ success: true, data: { items } });
  }));

  router.post("/me/vehicles", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const vehicle = await service.addVehicle({ userId: req.user.id, input: parsed.data });
    return res.status(201).json({ success: true, data: vehicle });
  }));

  router.patch("/me/vehicles/:vehicleId", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const params = idSchema.safeParse(req.params.vehicleId);
    const parsed = updateSchema.safeParse(req.body);
    if (!params.success || !parsed.success) return invalid(res, [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
    const vehicle = await service.updateVehicle({ userId: req.user.id, vehicleId: params.data, input: parsed.data });
    return res.status(200).json({ success: true, data: vehicle });
  }));

  router.post("/me/vehicles/:vehicleId/deactivate", authMiddleware, requireDriver, asyncWrapper(async (req, res) => {
    const params = idSchema.safeParse(req.params.vehicleId);
    if (!params.success) return invalid(res, params.error.issues);
    const result = await service.deactivateVehicle({ userId: req.user.id, vehicleId: params.data });
    return res.status(200).json({ success: true, data: result });
  }));

  return router;
}
