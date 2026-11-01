import { asyncWrapper } from "../../shared/http/async-wrapper.js";

export function createSupportController(service) {
  return {
    create: asyncWrapper(async (req, res) => res.status(201).json({
      success: true,
      data: await service.create({ user: req.user, input: req.body }),
    })),
    mine: asyncWrapper(async (req, res) => {
      const page = await service.listMine({
        userId: req.user.id,
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      return res.status(200).json({
        success: true,
        data: { items: page.data, nextCursor: page.nextCursor },
      });
    }),
    messages: asyncWrapper(async (req, res) => res.status(200).json({
      success: true,
      ...await service.listMessages({ ticketId: req.params.ticketId, user: req.user }),
    })),
    createMessage: asyncWrapper(async (req, res) => res.status(201).json({
      success: true,
      data: await service.createMessage({ ticketId: req.params.ticketId, user: req.user, input: req.body }),
    })),
    adminList: asyncWrapper(async (req, res) => {
      const page = await service.listAdmin({
        status: req.query.status,
        category: req.query.category,
        priority: req.query.priority,
        assignedToUserId: req.query.assignedToUserId,
        unassignedOnly: req.query.unassignedOnly === "true",
        q: req.query.q,
        cursor: req.query.cursor,
        limit: Number(req.query.limit) || 50,
      });
      return res.status(200).json({
        success: true,
        data: { items: page.data, nextCursor: page.nextCursor },
      });
    }),
    escalate: asyncWrapper(async (req, res) => {
      const result = await service.escalate({ id: req.params.ticketId, user: req.user, input: req.body });
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result });
    }),
    update: asyncWrapper(async (req, res) => res.status(200).json({
      success: true,
      data: await service.update({ id: req.params.ticketId, user: req.user, input: req.body }),
    })),
  };
}
