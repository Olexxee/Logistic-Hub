import { createPlatformOperationalTariffService } from "./platform-operational-tariff.service.js";
import {
  availabilityListSchema, availabilitySchema, reasonSchema, tariffIdSchema, tariffListSchema, tariffSchema,
} from "./platform-operational-tariff.validators.js";

const invalid = (res, issues) => res.status(400).json({
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "One or more fields are invalid.",
    details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  },
});

export function createPlatformOperationalTariffController({ prismaClient }) {
  const service = createPlatformOperationalTariffService({ prismaClient });
  return {
    list: async (req, res) => {
      const parsed = tariffListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      return res.status(200).json({ success: true, data: { items: await service.list(parsed.data) } });
    },
    create: async (req, res) => {
      const parsed = tariffSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      return res.status(201).json({ success: true, data: { tariff: await service.create(parsed.data, req.user.id) } });
    },
    publish: async (req, res) => {
      const id = tariffIdSchema.safeParse(req.params);
      const body = reasonSchema.safeParse(req.body);
      if (!id.success) return invalid(res, id.error.issues);
      if (!body.success) return invalid(res, body.error.issues);
      return res.status(200).json({ success: true, data: { tariff: await service.publish(id.data.tariffId, req.user.id, body.data.reason) } });
    },
    retire: async (req, res) => {
      const id = tariffIdSchema.safeParse(req.params);
      const body = reasonSchema.safeParse(req.body);
      if (!id.success) return invalid(res, id.error.issues);
      if (!body.success) return invalid(res, body.error.issues);
      return res.status(200).json({ success: true, data: { tariff: await service.retire(id.data.tariffId, req.user.id, body.data.reason) } });
    },
    listAvailability: async (req, res) => {
      const parsed = availabilityListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      return res.status(200).json({ success: true, data: { items: await service.listAvailability(parsed.data) } });
    },
    setAvailability: async (req, res) => {
      const parsed = availabilitySchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      return res.status(200).json({ success: true, data: { availability: await service.setAvailability(parsed.data, req.user.id) } });
    },
  };
}
