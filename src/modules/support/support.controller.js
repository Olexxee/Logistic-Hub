import { asyncWrapper } from "../../shared/http/async-wrapper.js";
export function createSupportController({ service }) {
  return {
    create: asyncWrapper(async (req, res) => res.status(201).json({ success: true, data: await service.create({ user: req.user, input: req.validated.body }) })),
    list: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.list({ user: req.user, status: req.query.status, limit: Number(req.query.limit ?? 50) }) })),
    get: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.get({ ticketId: req.params.ticketId, user: req.user }) })),
    reply: asyncWrapper(async (req, res) => res.status(201).json({ success: true, data: await service.reply({ ticketId: req.params.ticketId, user: req.user, body: req.validated.body.body, internal: req.validated.body.internal ?? false }) })),
    update: asyncWrapper(async (req, res) => res.status(200).json({ success: true, data: await service.update({ ticketId: req.params.ticketId, user: req.user, ...req.validated.body }) })),
  };
}
