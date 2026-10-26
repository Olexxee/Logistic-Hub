export function createSupportController({ service }) {
  return {
    create: async (req, res) => res.status(201).json({ success: true, data: await service.createTicket({ requester: req.user, input: req.validated.body }) }),
    mine: async (req, res) => res.status(200).json({ success: true, ...await service.listMine({ requesterId: req.user.id, ...req.validated.query }) }),
    adminList: async (req, res) => res.status(200).json({ success: true, ...await service.listAdmin(req.validated.query) }),
    update: async (req, res) => res.status(200).json({ success: true, data: await service.updateTicket({ ticketId: req.validated.params.ticketId, actor: req.user, input: req.validated.body }) }),
    cancel: async (req, res) => res.status(200).json({ success: true, data: await service.cancelBooking({ bookingType: req.validated.bookingType, bookingId: req.validated.params.bookingId, user: req.user, reason: req.validated.body.reason }) }),
  };
}
