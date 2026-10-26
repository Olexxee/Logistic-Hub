export function createAssignmentsController({ service }) {
  return {
    issueVerificationCode: async (req, res) => res.status(201).json({
      success: true,
      data: await service.issueVerificationCode({ assignmentId: req.validated.params.assignmentId, user: req.user }),
    }),
    markArrivedAtPickup: async (req, res) => res.status(200).json({
      success: true,
      data: await service.markArrivedAtPickup({ assignmentId: req.validated.params.assignmentId, user: req.user }),
    }),
    verifyCode: async (req, res) => res.status(200).json({
      success: true,
      data: await service.verifyCode({ assignmentId: req.validated.params.assignmentId, code: req.validated.body.code, user: req.user }),
    }),
    startParcelTransit: async (req, res) => res.status(200).json({
      success: true,
      data: await service.startParcelTransit({ assignmentId: req.validated.params.assignmentId, user: req.user }),
    }),
    markArrivedAtDestination: async (req, res) => res.status(200).json({
      success: true,
      data: await service.markArrivedAtDestination({ assignmentId: req.validated.params.assignmentId, user: req.user }),
    }),
    location: async (req, res) => {
      const data = await service.getVisibleLocation({ assignmentId: req.validated.params.assignmentId, user: req.user });
      return data
        ? res.status(200).json({ success: true, data })
        : res.status(404).json({ success: false, error: { code: "LOCATION_NOT_AVAILABLE", message: "No driver location has been recorded yet." } });
    },
  };
}
