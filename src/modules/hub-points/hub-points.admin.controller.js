import { createHubPointsAdminService } from "./hub-points.admin.service.js";
import {
  createHubPointAdminSchema,
  hubPointStatusAdminSchema,
  updateHubPointAdminSchema,
} from "./hub-points.admin.validators.js";

function invalid(res, issues) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "One or more fields are invalid.",
      details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
    },
  });
}

export function createHubPointsAdminController({ prismaClient }) {
  const service = createHubPointsAdminService({ prismaClient });
  const id = (req) => req.params.hubPointId;

  return {
    list: async (req, res, next) => {
      try {
        return res.status(200).json({ success: true, data: { items: await service.list() } });
      } catch (error) { return next(error); }
    },
    create: async (req, res, next) => {
      const parsed = createHubPointAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const hubPoint = await service.create(parsed.data);
        if (!hubPoint) return res.status(404).json({ success: false, error: { code: "SERVICE_ZONE_NOT_FOUND", message: "Service zone not found." } });
        return res.status(201).json({ success: true, data: { hubPoint } });
      } catch (error) { return next(error); }
    },
    update: async (req, res, next) => {
      const parsed = updateHubPointAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const hubPoint = await service.update(id(req), parsed.data);
        if (!hubPoint) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Hub point not found." } });
        return res.status(200).json({ success: true, data: { hubPoint } });
      } catch (error) { return next(error); }
    },
    setStatus: async (req, res, next) => {
      const parsed = hubPointStatusAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const hubPoint = await service.setStatus(id(req), parsed.data.status);
        if (!hubPoint) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Hub point not found." } });
        return res.status(200).json({ success: true, data: { hubPoint } });
      } catch (error) { return next(error); }
    },
  };
}
