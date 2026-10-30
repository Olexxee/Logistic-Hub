import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createPartnerExecutionService } from "./partner-execution.service.js";

export function createPartnerExecutionController({ prismaClient }) {
  const service = createPartnerExecutionService({ prismaClient });
  return {
    list: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.listAssignments({ partnerId: req.partner.id }) })),
    accept: asyncWrapper(async (req, res) => {
      const result = await service.transition({ partnerId: req.partner.id, assignmentId: req.params.assignmentId, action: "ACCEPT" });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner assignment not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
    reject: asyncWrapper(async (req, res) => {
      const result = await service.transition({ partnerId: req.partner.id, assignmentId: req.params.assignmentId, action: "REJECT", reason: req.body.reason });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner assignment not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
    start: asyncWrapper(async (req, res) => {
      const result = await service.transition({ partnerId: req.partner.id, assignmentId: req.params.assignmentId, action: "START" });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner assignment not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
    arrive: asyncWrapper(async (req, res) => {
      const result = await service.transition({ partnerId: req.partner.id, assignmentId: req.params.assignmentId, action: "ARRIVE" });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner assignment not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
    issueCredential: asyncWrapper(async (req, res) => {
      const result = await service.issueCredential({ partnerId: req.params.partnerId, label: req.body.label, expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined, actorUserId: req.user.id });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Transport partner not found." } });
      return res.status(201).json({ success: true, data: result });
    }),
    revokeCredential: asyncWrapper(async (req, res) => {
      const result = await service.revokeCredential({ partnerId: req.params.partnerId, credentialId: req.params.credentialId, actorUserId: req.user.id });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Partner API credential not found." } });
      return res.status(200).json({ success: true, data: result });
    }),
  };
}
