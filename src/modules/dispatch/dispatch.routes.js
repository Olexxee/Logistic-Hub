import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createDispatchService } from "./dispatch.service.js";
import { createNotificationsService } from "../notifications/notifications.service.js";
import { acceptFareSchema, proposeFareSchema } from "./dispatch.schemas.js";
import { idempotencyKeySchema } from "../parcels/parcel-bookings.schemas.js";

const idSchema = z.string().trim().min(1).max(128);

function validationError(res, issues) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "One or more fields are invalid.",
      details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
    },
  });
}

export function createDispatchRouter({ prismaClient = prisma } = {}) {
  const router = Router();
  const service = createDispatchService({ prismaClient });
  const notifications = createNotificationsService({ prismaClient });
  const requireDriver = requireRole("DRIVER");

  router.post("/parcel-bookings/:bookingId/request-matching", requireAuth, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.bookingId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    try {
      const result = await service.requestParcelMatching({ bookingId: parsedId.data, user: req.user });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The parcel booking was not found." } });
      if (result.status === "MATCHING" && result.offersCreated > 0) {
        const offers = await prismaClient.driverOffer.findMany({
          where: { parcelBookingId: result.bookingId, status: "OFFERED" },
          include: {
            driverProfile: { select: { userId: true } },
            parcelBooking: { select: { id: true, publicReference: true, pickupAddress: true, destinationAddress: true, parcelCategory: true } },
          },
        });
        await Promise.all(offers.map(async (offer) => {
          try {
            await notifications.createAndDeliver({
              userId: offer.driverProfile.userId,
              type: "PARCEL_OFFER_RECEIVED",
              title: "New parcel delivery offer",
              body: `A new parcel delivery offer is available for ${offer.parcelBooking.publicReference}. Pickup: ${offer.parcelBooking.pickupAddress}. Destination: ${offer.parcelBooking.destinationAddress}. Category: ${offer.parcelBooking.parcelCategory}. Submit a fare proposal before the offer expires.`,
              data: { bookingId: offer.parcelBooking.id, offerId: offer.id, publicReference: offer.parcelBooking.publicReference },
              deliveryKey: `parcel-offer-${offer.id}`,
              emailSubject: "New Logistic Hub parcel delivery offer",
            });
          } catch (notificationError) {
            req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not notify driver about parcel offer");
          }
        }));
      }
      return res.status(202).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/parcel-bookings/:bookingId/offers", requireAuth, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.bookingId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    try {
      const offers = await service.listParcelOffers({ bookingId: parsedId.data, user: req.user });
      if (!offers) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The parcel booking was not found." } });
      return res.status(200).json({ success: true, data: offers });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/driver/offers", requireAuth, requireDriver, async (req, res, next) => {
    try {
      const offers = await service.listDriverOffers({ userId: req.user.id });
      return res.status(200).json({ success: true, data: offers });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/driver/offers/:offerId/propose-fare", requireAuth, requireDriver, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.offerId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = proposeFareSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const idempotency = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!idempotency.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "A valid Idempotency-Key header is required." },
      });
    }
    try {
      const result = await service.proposeParcelFare({
        offerId: parsedId.data,
        userId: req.user.id,
        proposedFareMinor: parsed.data.proposedFareMinor,
        idempotencyKey: idempotency.data,
      });
      try {
        const offer = await prismaClient.driverOffer.findUnique({
          where: { id: parsedId.data },
          include: { parcelBooking: { select: { id: true, senderId: true, publicReference: true } } },
        });
        if (offer?.parcelBooking?.senderId) {
          await notifications.createAndDeliver({
            userId: offer.parcelBooking.senderId,
            type: "PARCEL_FARE_PROPOSED",
            title: "A driver proposed a fare",
            body: `A driver proposed ${result.proposedFareMinor} ${result.currency} for parcel booking ${offer.parcelBooking.publicReference}. Review the proposal and accept it if suitable. Payment is not collected until you accept a fare.`,
            data: { bookingId: offer.parcelBooking.id, offerId: result.offerId, proposedFareMinor: result.proposedFareMinor, currency: result.currency },
            deliveryKey: `parcel-fare-proposed-${result.offerId}`,
            emailSubject: "A driver proposed a fare for your Logistic Hub parcel",
          });
        }
      } catch (notificationError) {
        req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not notify sender about proposed fare");
      }
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({ success: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "The Idempotency-Key has already been used." } });
      }
      return next(error);
    }
  });

  router.post("/parcel-bookings/:bookingId/accept-fare", requireAuth, async (req, res, next) => {
    const parsedId = idSchema.safeParse(req.params.bookingId);
    if (!parsedId.success) return validationError(res, parsedId.error.issues);
    const parsed = acceptFareSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error.issues);
    const idempotency = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!idempotency.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "A valid Idempotency-Key header is required." },
      });
    }
    try {
      const result = await service.acceptParcelFare({
        bookingId: parsedId.data,
        user: req.user,
        offerId: parsed.data.offerId,
        idempotencyKey: idempotency.data,
      });
      if (!result) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "The parcel booking was not found." } });
      if (!result.replay && result.assignmentId) {
        try {
          const assignment = await prismaClient.driverAssignment.findUnique({
            where: { id: result.assignmentId },
            include: {
              driverProfile: { select: { userId: true } },
              parcelBooking: { select: { publicReference: true } },
            },
          });
          if (assignment?.driverProfile?.userId) {
            await notifications.createAndDeliver({
              userId: assignment.driverProfile.userId,
              type: "PARCEL_FARE_ACCEPTED",
              title: "Your fare proposal was accepted",
              body: `The sender accepted your fare for parcel booking ${assignment.parcelBooking.publicReference}. Payment is still pending. Do not start the delivery until payment is confirmed by Logistic Hub.`,
              data: { bookingId: parsedId.data, assignmentId: result.assignmentId, paymentExpiresAt: result.paymentExpiresAt },
              deliveryKey: `parcel-fare-accepted-${result.assignmentId}`,
              emailSubject: "Your Logistic Hub parcel fare was accepted",
            });
          }
        } catch (notificationError) {
          req.log?.warn({ code: notificationError.code ?? "NOTIFICATION_FAILED" }, "Could not notify driver that fare was accepted");
        }
      }
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({ success: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "The Idempotency-Key has already been used." } });
      }
      return next(error);
    }
  });

  return router;
}

export const dispatchRouter = createDispatchRouter();
