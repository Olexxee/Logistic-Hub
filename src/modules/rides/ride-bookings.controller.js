import { NotFoundError } from "../../shared/http/app-error.js";

export function createRideBookingsController({ service, notifications }) {
  return {
    create: async (req, res) => {
      const result = await service.createDraft({
        passengerId: req.user.id,
        idempotencyKey: req.validated.idempotencyKey,
        input: req.validated.body,
      });
      if (!result.replay) {
        try {
          await notifications.createAndDeliver({
            userId: req.user.id,
            type: "RIDE_BOOKING_CREATED",
            title: "Ride booking created",
            body: `Your ride booking ${result.ride.publicReference} has been created. A driver fare must be accepted before payment is collected.`,
            data: { rideBookingId: result.ride.id, publicReference: result.ride.publicReference },
            deliveryKey: `ride-booking-created-${result.ride.id}`,
            emailSubject: "Your Logistic Hub ride booking was created",
          });
        } catch (error) {
          req.log?.warn({ code: error.code ?? "NOTIFICATION_FAILED" }, "Could not create ride booking notification");
        }
      }
      return res.status(result.replay ? 200 : 201).json({ success: true, data: result.ride });
    },
    get: async (req, res) => {
      const ride = await service.getVisibleRide({ rideBookingId: req.validated.params.rideBookingId, user: req.user });
      if (!ride) throw new NotFoundError("The ride booking was not found.");
      return res.status(200).json({ success: true, data: ride });
    },
  };
}
