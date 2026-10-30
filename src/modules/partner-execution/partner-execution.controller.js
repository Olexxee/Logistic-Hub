function assignmentView(assignment) {
  if (!assignment) return assignment;
  return {
    ...assignment,
    agreedTransportChargeMinor: assignment.agreedTransportChargeMinor?.toString?.() ?? assignment.agreedTransportChargeMinor,
  };
}

export function createPartnerExecutionController(service) {
  return {
    addMember: async (req, res, next) => {
      try {
        const result = await service.addMember({ ...req.body, partnerId: req.params.partnerId, actorUserId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "PARTNER_NOT_FOUND", message: "Transport partner not found." } });
        if (result.blocker === "USER_NOT_ACTIVE") return res.status(409).json({ success: false, error: { code: "USER_NOT_ACTIVE", message: "Only active, email-verified users can be added to a partner." } });
        if (result.blocker === "USER_ROLE_CONFLICT") return res.status(409).json({ success: false, error: { code: "USER_ROLE_CONFLICT", message: "This user already has a role that cannot be converted to a partner operator." } });
        return res.status(201).json({ success: true, data: { member: result.member } });
      } catch (error) { return next(error); }
    },
    setMemberStatus: async (req, res, next) => {
      try {
        const result = await service.setMemberStatus({ partnerId: req.params.partnerId, memberId: req.params.memberId, isActive: req.body.isActive, actorUserId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "PARTNER_MEMBER_NOT_FOUND", message: "Partner member not found." } });
        return res.status(200).json({ success: true, data: { member: result.member } });
      } catch (error) { return next(error); }
    },
    assignLeg: async (req, res, next) => {
      try {
        const result = await service.assignLeg({ deliveryLegId: req.params.legId, partnerId: req.body.partnerId, idempotencyKey: req.get("Idempotency-Key"), actorUserId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "DELIVERY_LEG_NOT_FOUND", message: "Delivery leg not found." } });
        if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "The delivery leg or partner agreement is not eligible for partner assignment." } });
        return res.status(result.replay ? 200 : 201).json({ success: true, data: { assignment: assignmentView(result.assignment), replay: result.replay } });
      } catch (error) { return next(error); }
    },
    listMyAssignments: async (req, res, next) => {
      try {
        const result = await service.listMyAssignments({ userId: req.user.id, page: req.validatedQuery.page, limit: req.validatedQuery.limit });
        return res.status(200).json({ success: true, data: { items: result.items.map(assignmentView), pagination: result.pagination } });
      }
      catch (error) { return next(error); }
    },
    acceptAssignment: async (req, res, next) => {
      try {
        const result = await service.acceptAssignment({ assignmentId: req.params.assignmentId, userId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner assignment not found." } });
        if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "Partner assignment cannot be accepted in its current state." } });
        return res.status(200).json({ success: true, data: { assignment: result.assignment, replay: result.replay } });
      } catch (error) { return next(error); }
    },
    startAssignment: async (req, res, next) => {
      try {
        const result = await service.startAssignment({ assignmentId: req.params.assignmentId, userId: req.user.id });
        if (result.notFound) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner assignment not found." } });
        if (result.blocker) return res.status(409).json({ success: false, error: { code: result.blocker, message: "Partner assignment cannot start in its current state." } });
        return res.status(200).json({ success: true, data: { assignment: result.assignment, replay: result.replay } });
      } catch (error) { return next(error); }
    },
  };
}
