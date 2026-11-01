export function createCustodyController(service) {
  return {
    setRecipientPhoneVerification: async (req, res) => {
      const result = await service.setRecipientPhoneVerification({
        ...req.body, userId: req.params.userId, actorUserId: req.user.id,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found." } });
      if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active users can be phone-verified." } });
      if (result.blocker === "USER_PHONE_REQUIRED") return res.status(409).json({ success: false, error: { code: "USER_PHONE_REQUIRED", message: "A phone number must be present before verification." } });
      return res.status(200).json({ success: true, data: result });
    },
    listHubOperators: async (req, res) => {
      const result = await service.listHubOperators({ hubPointId: req.params.hubPointId, ...req.validatedQuery });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
      return res.status(200).json({ success: true, data: result });
    },
    listHubOperatorsForManager: async (req, res) => {
      const result = await service.listHubOperatorsForManager({
        hubPointId: req.params.hubPointId,
        userId: req.user.id,
        ...req.validatedQuery,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
      if (result.forbidden) return res.status(403).json({ success: false, error: { code: "HUB_MANAGER_REQUIRED", message: "An active manager membership for this hub is required." } });
      return res.status(200).json({ success: true, data: result });
    },
    addHubStaff: async (req, res) => {
      const result = await service.addHubStaff({
        ...req.body,
        hubPointId: req.params.hubPointId,
        actorUserId: req.user.id,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
      if (result.forbidden) return res.status(403).json({ success: false, error: { code: "HUB_MANAGER_REQUIRED", message: "An active manager membership for this hub is required." } });
      if (result.blocker) {
        const messages = {
          HUB_NOT_OPEN_FOR_STAFF: "Staff can only be added while the hub is pending or active.",
          SELF_MEMBERSHIP_CHANGE: "A hub manager cannot add themselves as staff.",
          USER_NOT_ACTIVE: "Only active, email-verified users can be added as hub staff.",
          MANAGER_MEMBERSHIP_PROTECTED: "Hub managers can add staff but cannot modify manager memberships.",
          ADMIN_REVIEW_REQUIRED: "This membership was previously deactivated by an administrator; administrator review is required before reactivation.",
        };
        return res.status(409).json({ success: false, error: { code: result.blocker, message: messages[result.blocker] } });
      }
      return res.status(result.replay ? 200 : 201).json({
        success: true,
        data: { operator: result.operator, replay: Boolean(result.replay) },
      });
    },
    addHubOperator: async (req, res) => {
      const result = await service.addHubOperator({ ...req.body, hubPointId: req.params.hubPointId, actorUserId: req.user.id });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
      if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can be added as hub operators." } });
      if (result.blocker === "HUB_CLOSED") return res.status(409).json({ success: false, error: { code: "HUB_CLOSED", message: "Closed hubs cannot receive new operators." } });
      if (result.blocker === "LAST_ACTIVE_HUB_MANAGER") return res.status(409).json({ success: false, error: { code: "LAST_ACTIVE_HUB_MANAGER", message: "An active hub must retain at least one active manager." } });
      return res.status(result.replay ? 200 : 201).json({ success: true, data: { operator: result.operator, replay: Boolean(result.replay) } });
    },
    setHubOperatorStatus: async (req, res) => {
      const result = await service.setHubOperatorStatus({ hubPointId: req.params.hubPointId, operatorId: req.params.operatorId, ...req.body, actorUserId: req.user.id });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_OPERATOR_NOT_FOUND", message: "Hub operator not found." } });
      if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can hold an active hub membership or become a manager." } });
      if (result.blocker === "HUB_CLOSED") return res.status(409).json({ success: false, error: { code: "HUB_CLOSED", message: "Closed hub memberships cannot be modified." } });
      if (result.blocker === "LAST_ACTIVE_HUB_MANAGER") return res.status(409).json({ success: false, error: { code: "LAST_ACTIVE_HUB_MANAGER", message: "An active hub must retain at least one active manager." } });
      return res.status(200).json({ success: true, data: { operator: result.operator, replay: Boolean(result.replay) } });
    },
    setHubOperatorDispatchPermission: async (req, res) => {
      const result = await service.setHubOperatorDispatchPermission({
        hubPointId: req.params.hubPointId,
        operatorId: req.params.operatorId,
        ...req.body,
        actorUserId: req.user.id,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_OPERATOR_NOT_FOUND", message: "Hub operator not found." } });
      if (result.blocker === "HUB_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "HUB_NOT_ACTIVE", message: "Dispatch permission can only be granted while the hub is active." } });
      if (result.blocker === "OPERATOR_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "OPERATOR_NOT_ACTIVE", message: "Dispatch permission can only be granted to an active membership belonging to an active, email-verified user." } });
      return res.status(200).json({ success: true, data: { operator: result.operator, replay: Boolean(result.replay) } });
    },
    updateHubOperatorRole: async (req, res) => {
      const result = await service.updateHubOperatorRole({
        hubPointId: req.params.hubPointId, operatorId: req.params.operatorId,
        ...req.body, actorUserId: req.user.id,
      });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_OPERATOR_NOT_FOUND", message: "Hub operator not found." } });
      if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can hold an active hub membership or become a manager." } });
      if (result.blocker === "HUB_CLOSED") return res.status(409).json({ success: false, error: { code: "HUB_CLOSED", message: "Closed hub memberships cannot be modified." } });
      if (result.blocker === "LAST_ACTIVE_HUB_MANAGER") return res.status(409).json({ success: false, error: { code: "LAST_ACTIVE_HUB_MANAGER", message: "An active hub must retain at least one active manager." } });
      return res.status(200).json({ success: true, data: { operator: result.operator, replay: Boolean(result.replay) } });
    },
    createHandover: async (req, res) => {
      const result = await service.createHandover(req.body, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "DELIVERY_LEG_NOT_FOUND", message: "Delivery leg or booking not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "A custody handover cannot be initiated in the current state." } });
      return res.status(201).json({ success: true, data: { handover: result.handover } });
    },
    confirmHandover: async (req, res) => {
      const result = await service.confirmHandover({ handoverId: req.params.handoverId, userId: req.user.id, ...req.body });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HANDOVER_NOT_FOUND", message: "Custody handover not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The custody handover is no longer awaiting confirmation." } });
      return res.status(200).json({ success: true, data: result });
    },
    listHubIntakes: async (req, res) => {
      const result = await service.listHubIntakes({ ...req.validatedQuery, userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
    },
    listHubHandovers: async (req, res) => {
      const result = await service.listHubHandovers({ ...req.validatedQuery, userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
    },
    listHubDispatchable: async (req, res) => {
      const result = await service.listHubDispatchable({ ...req.validatedQuery, userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
    },
    createDriverHubHandover: async (req, res) => {
      const result = await service.createDriverHubHandover(req.body, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "ASSIGNMENT_NOT_FOUND", message: "Driver assignment not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The driver cannot release this assignment into hub custody in the current state." } });
      return res.status(201).json({ success: true, data: { handover: result.handover } });
    },
    createHubHandover: async (req, res) => {
      const result = await service.createHubHandover(req.body, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "DELIVERY_LEG_NOT_FOUND", message: "Delivery leg not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The hub cannot release custody to this party in the current state." } });
      return res.status(201).json({ success: true, data: { handover: result.handover } });
    },
    decideHubHandover: async (req, res) => {
      const result = await service.confirmHandover({ handoverId: req.params.handoverId, userId: req.user.id, ...req.body });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HANDOVER_NOT_FOUND", message: "Custody handover not found." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The custody handover is no longer awaiting confirmation." } });
      return res.status(200).json({ success: true, data: result });
    },
    reportHubException: async (req, res) => {
      const result = await service.reportHubException(req.body, req.user.id);
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_LEG_NOT_FOUND", message: "Hub or delivery leg not found for this shipment." } });
      if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "A hub exception cannot be reported for this shipment state." } });
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result });
    },
    listMyHandovers: async (req, res) => {
      const items = await service.listMyHandovers(req.user.id);
      return res.status(200).json({ success: true, data: { items } });
    },
  };
}
