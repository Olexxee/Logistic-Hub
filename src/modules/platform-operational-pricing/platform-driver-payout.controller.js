import { createPlatformDriverPayoutService } from "./platform-driver-payout.service.js";
import {
  driverPayoutListSchema,
  driverPayoutReasonSchema,
  driverPayoutRuleIdSchema,
  driverPayoutRuleSchema,
} from "./platform-driver-payout.validators.js";

const invalid = (res, issues) => res.status(400).json({
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "One or more fields are invalid.",
    details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
  },
});

export function createPlatformDriverPayoutController({ prismaClient }) {
  const service = createPlatformDriverPayoutService({ prismaClient });
  return {
    list: async (req, res) => {
      const parsed = driverPayoutListSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      return res.status(200).json({ success: true, data: { items: await service.list(parsed.data) } });
    },
    create: async (req, res) => {
      const parsed = driverPayoutRuleSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error.issues);
      return res.status(201).json({ success: true, data: { rule: await service.create(parsed.data, req.user.id) } });
    },
    publish: async (req, res) => {
      const id = driverPayoutRuleIdSchema.safeParse(req.params);
      const body = driverPayoutReasonSchema.safeParse(req.body);
      if (!id.success) return invalid(res, id.error.issues);
      if (!body.success) return invalid(res, body.error.issues);
      return res.status(200).json({ success: true, data: { rule: await service.publish(id.data.ruleId, req.user.id, body.data.reason) } });
    },
    retire: async (req, res) => {
      const id = driverPayoutRuleIdSchema.safeParse(req.params);
      const body = driverPayoutReasonSchema.safeParse(req.body);
      if (!id.success) return invalid(res, id.error.issues);
      if (!body.success) return invalid(res, body.error.issues);
      return res.status(200).json({ success: true, data: { rule: await service.retire(id.data.ruleId, req.user.id, body.data.reason) } });
    },
  };
}
