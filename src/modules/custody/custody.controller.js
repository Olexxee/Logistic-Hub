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
    addHubOperator: async (req, res) => {
      const result = await service.addHubOperator({ ...req.body, hubPointId: req.params.hubPointId, actorUserId: req.user.id });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_NOT_FOUND", message: "Hub point not found." } });
      if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can be added as hub operators." } });
      if (result.blocker === "USER_ROLE_CONFLICT") return res.status(409).json({ success: false, error: { code: "USER_ROLE_CONFLICT", message: "This user has an incompatible account role." } });
      return res.status(201).json({ success: true, data: { operator: result.operator } });
    },
    setHubOperatorStatus: async (req, res) => {
      const result = await service.setHubOperatorStatus({ hubPointId: req.params.hubPointId, operatorId: req.params.operatorId, isActive: req.body.isActive, actorUserId: req.user.id });
      if (result.notFound) return res.status(404).json({ success: false, error: { code: "HUB_OPERATOR_NOT_FOUND", message: "Hub operator not found." } });
      return res.status(200).json({ success: true, data: { operator: result.operator } });
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
    listHubHandovers: async (req, res) => {
      const result = await service.listHubHandovers({ ...req.validatedQuery, userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
    },
    listHubDispatchable: async (req, res) => {
      const result = await service.listHubDispatchable({ ...req.validatedQuery, userId: req.user.id });
      return res.status(200).json({ success: true, data: result });
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
      return res.status(201).json({ success: true, data: result });
    },
    listMyHandovers: async (req, res) => {
      const items = await service.listMyHandovers(req.user.id);
      return res.status(200).json({ success: true, data: { items } });
    },
  };
}
