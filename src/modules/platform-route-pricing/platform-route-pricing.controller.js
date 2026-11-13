import { createPlatformRoutePricingService } from "./platform-route-pricing.service.js";
import { availabilityListSchema, availabilitySchema, rateSchema, reasonSchema, listSchema } from "./platform-route-pricing.validators.js";

const invalid = (res, issues) => res.status(400).json({
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "One or more fields are invalid.",
    details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  },
});

export function createPlatformRoutePricingController({ prismaClient }) {
  const service = createPlatformRoutePricingService({ prismaClient });
  return {
    list: async (req, res, next) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        return res.status(200).json({ success: true, data: { items: await service.list(parsed.data) } });
      } catch (error) {
        return next(error);
      }
    },
    listAvailability: async (req, res, next) => {
      const parsed = availabilityListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        return res.status(200).json({ success: true, data: { items: await service.listAvailability(parsed.data) } });
      } catch (error) {
        return next(error);
      }
    },
    availability: async (req, res, next) => {
      const parsed = availabilitySchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        return res.status(200).json({ success: true, data: { availability: await service.setAvailability(parsed.data, req.user.id) } });
      } catch (error) {
        return next(error);
      }
    },
    create: async (req, res, next) => {
      const parsed = rateSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        return res.status(201).json({ success: true, data: { rate: await service.create(parsed.data, req.user.id) } });
      } catch (error) {
        return next(error);
      }
    },
    publish: async (req, res, next) => {
      const parsed = reasonSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        return res.status(200).json({ success: true, data: { rate: await service.publish(req.params.rateId, req.user.id, parsed.data.reason) } });
      } catch (error) {
        return next(error);
      }
    },
    retire: async (req, res, next) => {
      const parsed = reasonSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      try {
        return res.status(200).json({ success: true, data: { rate: await service.retire(req.params.rateId, req.user.id, parsed.data.reason) } });
      } catch (error) {
        return next(error);
      }
    },
  };
}
