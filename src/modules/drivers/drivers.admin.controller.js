import { z } from "zod";
import { createDriversAdminService } from "./drivers.admin.service.js";
import { driverAdminListSchema, vehicleAdminListSchema, driverAdminStatusSchema, driverAdminAuditSchema } from "./drivers.admin.validators.js";
function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more request fields are invalid.",
    details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
  } });
}
export function createDriversAdminController({ prismaClient }) {
  const service = createDriversAdminService({ prismaClient });
  return {
    listDrivers: async (req, res, next) => {
      const parsed = driverAdminListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try { return res.status(200).json({ success: true, data: await service.listDrivers(parsed.data) }); }
      catch (error) { return next(error); }
    },
    setDriverStatus: async (req, res, next) => {
      const parsed = driverAdminStatusSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        const driver = await service.setDriverStatus({ ...parsed.data, driverProfileId: req.params.driverProfileId, actorUserId: req.user.id });
        if (!driver) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
        return res.status(200).json({ success: true, data: { driver } });
      } catch (error) { return next(error); }
    },
    listDriverAudit: async (req, res, next) => {
      const parsedId = z.string().trim().min(1).max(128).safeParse(req.params.driverProfileId);
      const parsed = driverAdminAuditSchema.safeParse(req.query);
      if (!parsedId.success || !parsed.success) return invalid(res, [...(parsedId.success ? [] : parsedId.error.issues), ...(parsed.success ? [] : parsed.error.issues)]);
      try {
        const driver = await prismaClient.driverProfile.findUnique({ where: { id: parsedId.data }, select: { id: true } });
        if (!driver) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Driver profile not found." } });
        return res.status(200).json({ success: true, data: await service.listDriverAudit({ ...parsed.data, driverProfileId: parsedId.data }) });
      } catch (error) { return next(error); }
    },
    listVehicles: async (req, res, next) => {
      const parsed = vehicleAdminListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try { return res.status(200).json({ success: true, data: await service.listVehicles(parsed.data) }); }
      catch (error) { return next(error); }
    },
  };
}
