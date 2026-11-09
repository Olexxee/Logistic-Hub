import { createServiceZonesAdminService } from "./service-zones.admin.service.js";
import {
  createServiceZoneAdminSchema,
  serviceAvailabilityAdminSchema,
  serviceZoneStatusAdminSchema,
  updateServiceZoneAdminSchema,
} from "./service-zones.admin.validators.js";
import { serviceZoneReadinessQuerySchema } from "./service-zones.schemas.js";

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR",
    message: "One or more fields are invalid.",
    details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
  } });
}

export function createServiceZonesAdminController({ prismaClient }) {
  const service = createServiceZonesAdminService({ prismaClient });
  return {
    readiness: async (req, res, next) => {
      const parsed = serviceZoneReadinessQuerySchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try { return res.status(200).json({ success: true, data: await service.listReadiness(parsed.data.serviceType) }); }
      catch (error) { return next(error); }
    },
    list: async (req, res, next) => {
      try { return res.status(200).json({ success: true, data: { items: await service.list() } }); }
      catch (error) { return next(error); }
    },
    create: async (req, res, next) => {
      const parsed = createServiceZoneAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const zone = await service.create(parsed.data, req.user.id);
        if (!zone) return res.status(404).json({ success: false, error: { code: "STATE_NOT_FOUND", message: "State not found." } });
        return res.status(201).json({ success: true, data: { serviceZone: zone } });
      } catch (error) { return next(error); }
    },
    update: async (req, res, next) => {
      const parsed = updateServiceZoneAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const zone = await service.update(req.params.serviceZoneId, parsed.data, req.user.id);
        if (!zone) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Service zone not found." } });
        return res.status(200).json({ success: true, data: { serviceZone: zone } });
      } catch (error) { return next(error); }
    },
    setActive: async (req, res, next) => {
      const parsed = serviceZoneStatusAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const zone = await service.setActive(req.params.serviceZoneId, parsed.data.isActive, req.user.id);
        if (!zone) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Service zone not found." } });
        return res.status(200).json({ success: true, data: { serviceZone: zone } });
      } catch (error) { return next(error); }
    },
    setAvailability: async (req, res, next) => {
      const parsed = serviceAvailabilityAdminSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const availability = await service.setAvailability(req.params.serviceZoneId, parsed.data, req.user.id);
        if (!availability) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Service zone not found." } });
        return res.status(200).json({ success: true, data: { availability } });
      } catch (error) { return next(error); }
    },
  };
}
