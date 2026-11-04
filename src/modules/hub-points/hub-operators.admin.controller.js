import { createHubOperatorsAdminService } from "./hub-operators.admin.service.js";

export function createHubOperatorsAdminController({ prismaClient }) {
  const service = createHubOperatorsAdminService({ prismaClient });
  return {
    list: async (req, res, next) => {
      try {
        const result = await service.list({ hubPointId: req.params.hubPointId, ...req.validatedQuery });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
        return res.status(200).json({ success: true, data: result });
      } catch (error) { return next(error); }
    },
    add: async (req, res, next) => {
      try {
        const result = await service.add({ ...req.body, hubPointId: req.params.hubPointId, actorUserId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
        if (result.blocker === "HUB_CLOSED") return res.status(409).json({ success: false, error: { code: "HUB_CLOSED", message: "Closed hubs cannot receive new operators." } });
        if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can be assigned to a hub." } });
        return res.status(result.unchanged ? 200 : 201).json({ success: true, data: { member: result.member, unchanged: Boolean(result.unchanged) } });
      } catch (error) { return next(error); }
    },
    update: async (req, res, next) => {
      try {
        const result = await service.update({ ...req.body, hubPointId: req.params.hubPointId, memberId: req.params.memberId, actorUserId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
        if (result.memberNotFound) return res.status(404).json({ success: false, error: { code: "HUB_OPERATOR_NOT_FOUND", message: "Hub operator membership not found." } });
        if (result.blocker === "HUB_CLOSED") return res.status(409).json({ success: false, error: { code: "HUB_CLOSED", message: "Closed hub memberships cannot be modified." } });
        if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can be reactivated." } });
        return res.status(200).json({ success: true, data: { member: result.member, unchanged: Boolean(result.unchanged) } });
      } catch (error) { return next(error); }
    },
  };
}
