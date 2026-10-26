import { asyncWrapper } from "../../shared/http/async-wrapper.js";
export function createAssignmentsController({ service }) {
  return {
    location: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.getVisibleLocation({ assignmentId: req.params.assignmentId, user: req.user }) })),
    issueCode: asyncWrapper(async (req, res) => res.status(201).json({ success: true, data: await service.issueCode({ assignmentId: req.params.assignmentId, user: req.user, action: req.body.action }) })),
    arrivedPickup: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.markArrived({ assignmentId: req.params.assignmentId, user: req.user }) })),
    arrivedDestination: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.markArrived({ assignmentId: req.params.assignmentId, user: req.user, destination: true }) })),
    verifyCode: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.verifyCode({ assignmentId: req.params.assignmentId, user: req.user, action: req.body.action, code: req.body.code }) })),
  };
}
