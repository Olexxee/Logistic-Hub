export function createSupportController({ service }) {
  return {
    create: async (req, res) => res.status(201).json({ success: true, data: await service.createTicket({ requester: req.user, input: req.validated.body }) }),
    mine: async (req, res) => res.status(200).json({ success: true, ...await service.listMine({ requesterId: req.user.id, cursor: req.query.cursor, limit: req.query.limit ? Number(req.query.limit) : 20 }) }),
    adminList: async (req, res) => res.status(200).json({ success: true, ...await service.listAdmin({ status: req.query.status, priority: req.query.priority, cursor: req.query.cursor, limit: req.query.limit ? Number(req.query.limit) : 50 }) }),
    update: async (req, res) => res.status(200).json({ success: true, data: await service.updateTicket({ ticketId: req.validated.params.ticketId, actor: req.user, input: req.validated.body }) }),
    cancel: async (req, res) => res.status(200).json({ success: true, data: await service.cancelBooking({ bookingType: req.validated.bookingType, bookingId: req.validated.params.bookingId, user: req.user, reason: req.validated.body.reason }) }),
  };
}
