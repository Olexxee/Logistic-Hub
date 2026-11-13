import { NotFoundError } from "../../shared/http/app-error.js";

export function createParcelBookingsController({ service, notifications, quoteService }) {
  return {
    createQuote: async (req, res) => {
      const result = await quoteService.createQuote({ bookingId: req.validated.params.bookingId, userId: req.user.id, expiresInMinutes: req.validated.body.expiresInMinutes });
      if (result.notFound || result.forbidden) throw new NotFoundError("The parcel booking was not found.");
      if (result.conflict) return res.status(409).json({ success: false, error: result.conflict });
      return res.status(201).json({ success: true, data: result });
    },
    listQuotes: async (req, res) => {
      const result = await quoteService.listQuotes({ bookingId: req.validated.params.bookingId, userId: req.user.id });
      if (result.notFound || result.forbidden) throw new NotFoundError("The parcel booking was not found.");
      return res.status(200).json({ success: true, data: result });
    },
    acceptQuote: async (req, res) => {
      const result = await quoteService.acceptQuote({ bookingId: req.validated.params.bookingId, quoteId: req.validated.params.quoteId, userId: req.user.id });
      if (result.notFound || result.forbidden) throw new NotFoundError("The shipment quote was not found.");
      if (result.conflict) return res.status(409).json({ success: false, error: result.conflict });
      return res.status(200).json({ success: true, data: result });
    },
    rejectQuote: async (req, res) => {
      const result = await quoteService.rejectQuote({ bookingId: req.validated.params.bookingId, quoteId: req.validated.params.quoteId, userId: req.user.id });
      if (result.notFound || result.forbidden) throw new NotFoundError("The shipment quote was not found.");
      if (result.conflict) return res.status(409).json({ success: false, error: result.conflict });
      return res.status(200).json({ success: true, data: result });
    },
    list: async (req, res) => {
      const result = await service.listVisibleBookings({
        user: req.user,
        page: req.validated.query.page,
        limit: req.validated.query.limit,
        ...req.validated.query,
      });
      return res.status(200).json({ success: true, data: result });
    },
    create: async (req, res) => {
      const result = await service.createDraft({
        senderId: req.user.id,
        idempotencyKey: req.validated.idempotencyKey,
        input: req.validated.body,
      });
      if (!result.replay) {
        try {
          await notifications.createAndDeliver({
            userId: req.user.id,
            type: "PARCEL_BOOKING_CREATED",
            title: "Parcel booking created",
            body: `Your parcel booking ${result.booking.publicReference} has been created. A driver fare must be accepted before payment is collected.`,
            data: { bookingId: result.booking.id, publicReference: result.booking.publicReference },
            deliveryKey: `parcel-booking-created-${result.booking.id}`,
            emailSubject: "Your Logistic Hub parcel booking was created",
          });
        } catch (error) {
          req.log?.warn({ code: error.code ?? "NOTIFICATION_FAILED" }, "Could not create parcel booking notification");
        }
      }
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result.booking });
    },
    get: async (req, res) => {
      const booking = await service.getVisibleBooking({ bookingId: req.validated.params.bookingId, user: req.user });
      if (!booking) throw new NotFoundError("The parcel booking was not found.");
      return res.status(200).json({ success: true, data: booking });
    },
    listDeliveryLegs: async (req, res) => {
      const legs = await service.listVisibleDeliveryLegs({ bookingId: req.validated.params.bookingId, user: req.user });
      if (!legs) throw new NotFoundError("The parcel booking was not found.");
      return res.status(200).json({ success: true, data: legs });
    },
  };
}
