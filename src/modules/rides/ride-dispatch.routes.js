import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";
import { acceptFareSchema, listDriverOffersQuerySchema, proposeFareSchema } from "../dispatch/dispatch.schemas.js";
import { createRideDispatchService } from "./ride-dispatch.service.js";
import { createNotificationsService } from "../notifications/notifications.service.js";

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "One or more fields are invalid.", details: issues.map(({ path, message }) => ({ path: path.join("."), message })) },
  });
}
const idSchema = z.string().trim().min(1).max(128);

export function createRideDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createRideDispatchService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });
  const requireDriver = requireRole("DRIVER");

  router.post("/ride-bookings/:rideBookingId/request-matching", requireAuth, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.rideBookingId);
    if (!id.success) return validationError(res, id.error.issues);
    try {
      const result = await service.requestMatching({ rideBookingId: id.data, user: req.user });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ride booking not found." } });
      const offers = await prismaClient.driverOffer.findMany({
        where: { rideBookingId: result.rideBookingId, status: "OFFERED" },
        include: {
          driverProfile: { select: { userId: true } },
          rideBooking: { select: { id: true, publicReference: true, pickupAddress: true, destinationAddress: true, vehicleType: true } },
        },
      });
      await Promise.all(offers.map(async (offer) => {
        try {
          await notifications.createAndDeliver({
            userId: offer.driverProfile.userId,
            type: "RIDE_OFFER_RECEIVED",
            title: "New passenger ride offer",
            body: `A new ride offer is available for ${offer.rideBooking.publicReference}. Pickup: ${offer.rideBooking.pickupAddress}. Destination: ${offer.rideBooking.destinationAddress}. Requested vehicle: ${offer.rideBooking.vehicleType}. Submit a fare proposal before the offer expires.`,
            data: { rideBookingId: offer.rideBooking.id, offerId: offer.id, publicReference: offer.rideBooking.publicReference },
            deliveryKey: `ride-offer-${offer.id}`,
            emailSubject: "New Logistic Hub passenger ride offer",
          });
        } catch (notificationError) {
          req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not notify driver about ride offer");
        }
      }));
      return res.status(202).json({ success: true, data: result });
    } catch (error) { return next(error); }
  });

  router.get("/ride-bookings/:rideBookingId/offers", requireAuth, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.rideBookingId);
    if (!id.success) return validationError(res, id.error.issues);
    try {
      const offers = await service.listPassengerOffers({ rideBookingId: id.data, user: req.user });
      return offers === null
        ? res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ride booking not found." } })
        : res.status(200).json({ success: true, data: offers });
    } catch (error) { return next(error); }
  });

  router.get("/driver/ride-offers", requireAuth, requireDriver, async (req, res, next) => {
    const query = listDriverOffersQuerySchema.safeParse(req.query);
    if (!query.success) return validationError(res, query.error.issues);
    try {
      const result = await service.listDriverOffers({ userId: req.user.id, ...query.data });
      return res.status(200).json({ success: true, data: result.data, page: { nextCursor: result.nextCursor } });
    } catch (error) { return next(error); }
  });

  router.post("/driver/ride-offers/:offerId/propose-fare", requireAuth, requireDriver, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.offerId);
    if (!id.success) return validationError(res, id.error.issues);
    const body = proposeFareSchema.safeParse(req.body);
    if (!body.success) return validationError(res, body.error.issues);
    const key = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!key.success) return validationError(res, [{ path: ["Idempotency-Key"], message: "A valid Idempotency-Key header is required." }]);
    try {
      const result = await service.proposeFare({ offerId: id.data, userId: req.user.id, proposedFareMinor: body.data.proposedFareMinor, idempotencyKey: key.data });
      try {
        const offer = await prismaClient.driverOffer.findUnique({
          where: { id: id.data },
          include: { rideBooking: { select: { id: true, passengerId: true, publicReference: true } } },
        });
        if (offer?.rideBooking?.passengerId) {
          await notifications.createAndDeliver({
            userId: offer.rideBooking.passengerId,
            type: "RIDE_FARE_PROPOSED",
            title: "A driver proposed a ride fare",
            body: `A driver proposed ${result.proposedFareMinor} ${result.currency} for ride booking ${offer.rideBooking.publicReference}. Review the proposal and accept it if suitable. Payment is not collected until you accept a fare.`,
            data: { rideBookingId: offer.rideBooking.id, offerId: result.offerId, proposedFareMinor: result.proposedFareMinor, currency: result.currency },
            deliveryKey: `ride-fare-proposed-${result.offerId}`,
            emailSubject: "A driver proposed a fare for your Logistic Hub ride",
          });
        }
      } catch (notificationError) {
        req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not notify passenger about proposed ride fare");
      }
      return res.status(200).json({ success: true, data: result });
    } catch (error) { return next(error); }
  });

  router.post("/ride-bookings/:rideBookingId/accept-fare", requireAuth, async (req, res, next) => {
    const id = idSchema.safeParse(req.params.rideBookingId);
    if (!id.success) return validationError(res, id.error.issues);
    const body = acceptFareSchema.safeParse(req.body);
    if (!body.success) return validationError(res, body.error.issues);
    const key = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!key.success) return validationError(res, [{ path: ["Idempotency-Key"], message: "A valid Idempotency-Key header is required." }]);
    try {
      const result = await service.acceptFare({ rideBookingId: id.data, user: req.user, offerId: body.data.offerId, idempotencyKey: key.data });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Ride booking not found." } });
      if (!result.replay && result.assignmentId) {
        try {
          const assignment = await prismaClient.driverAssignment.findUnique({
            where: { id: result.assignmentId },
            include: { driverProfile: { select: { userId: true } }, rideBooking: { select: { publicReference: true } } },
          });
          if (assignment?.driverProfile?.userId) {
            await notifications.createAndDeliver({
              userId: assignment.driverProfile.userId,
              type: "RIDE_FARE_ACCEPTED",
              title: "Your ride fare proposal was accepted",
              body: `The passenger accepted your fare for ride booking ${assignment.rideBooking.publicReference}. Payment is still pending. Do not start the trip until payment is confirmed by Logistic Hub.`,
              data: { rideBookingId: id.data, assignmentId: result.assignmentId, paymentExpiresAt: result.paymentExpiresAt },
              deliveryKey: `ride-fare-accepted-${result.assignmentId}`,
              emailSubject: "Your Logistic Hub ride fare was accepted",
            });
          }
        } catch (notificationError) {
          req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not notify driver that ride fare was accepted");
        }
      }
      return res.status(200).json({ success: true, data: result });
    } catch (error) { return next(error); }
  });

  return router;
}
export const rideDispatchRouter = createRideDispatchRouter();
