import { createDriversAdminService } from "./drivers.admin.service.js";
import { driverAdminListSchema, vehicleAdminListSchema } from "./drivers.admin.validators.js";
function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
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
    listVehicles: async (req, res, next) => {
      const parsed = vehicleAdminListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try { return res.status(200).json({ success: true, data: await service.listVehicles(parsed.data) }); }
      catch (error) { return next(error); }
    },
  };
}
