import { randomInt } from "node:crypto";
import { hashOpaqueToken } from "../auth/auth.crypto.js";
import { ForbiddenError, NotFoundError, ConflictError, ValidationError } from "../../shared/http/app-error.js";
import { createAssignmentsRepository } from "./assignments.repository.js";

const ACTIONS = new Set(["PARCEL_PICKUP", "PARCEL_DELIVERY", "RIDE_PICKUP", "RIDE_COMPLETION"]);
export function createAssignmentsService({ prismaClient, clock = () => new Date() }) {
  const repository = createAssignmentsRepository({ prismaClient });
  async function load(assignmentId) {
    const assignment = await repository.findById(assignmentId);
    if (!assignment) throw new NotFoundError("Assignment not found.");
    return assignment;
  }
  function driverOwns(assignment, user) {
    if (user.role !== "DRIVER" || assignment.driverProfile.userId !== user.id) throw new ForbiddenError("Only the assigned driver can perform this action.");
  }
  function bookingOwner(assignment, user) {
    const ownerId = assignment.rideBooking?.passengerId ?? assignment.parcelBooking?.senderId;
    if (!ownerId || ownerId !== user.id) throw new ForbiddenError("Only the booking owner can request a verification code.");
  }
  return {
    async getVisibleLocation({ assignmentId, user }) {
      const assignment = await load(assignmentId);
      const ownerId = assignment.rideBooking?.passengerId ?? assignment.parcelBooking?.senderId;
      if (ownerId !== user.id && assignment.driverProfile.userId !== user.id && !["ADMIN", "SUPPORT"].includes(user.role)) throw new ForbiddenError("You cannot view this driver location.");
      if (["COMPLETED", "CANCELLED", "FAILED"].includes(assignment.status)) throw new ConflictError("Live location is unavailable after the assignment ends.", "LOCATION_VISIBILITY_ENDED");
      const location = await repository.findLatestLocation(assignment.driverProfileId);
      if (!location || clock().getTime() - location.recordedAt.getTime() > 2 * 60_000) return { available: false, reason: "LOCATION_STALE" };
      return { available: true, location: { latitude: location.latitude.toString(), longitude: location.longitude.toString(), accuracyMeters: location.accuracyMeters?.toString() ?? null, recordedAt: location.recordedAt } };
    },
    async issueCode({ assignmentId, user, action }) {
      if (!ACTIONS.has(action)) throw new ValidationError("Unsupported verification action.");
      const assignment = await load(assignmentId);
      bookingOwner(assignment, user);
      if ((action.startsWith("RIDE_") && !assignment.rideBookingId) || (action.startsWith("PARCEL_") && !assignment.parcelBookingId)) {
        throw new ConflictError("Verification action does not match this booking.", "VERIFICATION_ACTION_MISMATCH");
      }
      const allowed = action === "RIDE_PICKUP" || action === "PARCEL_PICKUP"
        ? ["ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED"]
        : ["ARRIVED_AT_DESTINATION", "IN_PROGRESS"];
      if (!allowed.includes(assignment.status)) throw new ConflictError("The assignment is not at the required stage for verification.", "INVALID_ASSIGNMENT_STATE");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const record = await repository.createVerification({
        assignment, action, tokenHash: hashOpaqueToken(code),
        expiresAt: new Date(clock().getTime() + 15 * 60_000),
      });
      return { assignmentId, action, code, expiresAt: record.expiresAt, note: "Share this code only with the assigned driver." };
    },
    async markArrived({ assignmentId, user, destination = false }) {
      const assignment = await load(assignmentId);
      driverOwns(assignment, user);
      const toStatus = destination ? "ARRIVED_AT_DESTINATION" : "ARRIVED_AT_PICKUP";
      const fromStatuses = destination ? ["IN_PROGRESS"] : ["ACCEPTED"];
      const bookingStatus = assignment.rideBookingId
        ? (destination ? "TRIP_COMPLETION_PENDING" : "DRIVER_ARRIVED")
        : (destination ? "DELIVERY_VERIFICATION_PENDING" : "PICKUP_VERIFICATION_PENDING");
      const updated = await repository.transition({
        assignment, fromStatuses, toStatus, actorUserId: user.id,
        eventType: destination ? "DRIVER_ARRIVED_AT_DESTINATION" : "DRIVER_ARRIVED_AT_PICKUP",
        bookingStatus,
      });
      if (!updated) throw new ConflictError("The assignment has changed and cannot make this transition.", "ASSIGNMENT_STATE_CONFLICT");
      return { id: updated.id, status: updated.status };
    },
    async verifyCode({ assignmentId, user, action, code }) {
      const assignment = await load(assignmentId);
      driverOwns(assignment, user);
      if (!ACTIONS.has(action) || !/^\d{6}$/.test(code)) throw new ValidationError("A valid verification action and six-digit code are required.");
      if ((action.startsWith("RIDE_") && !assignment.rideBookingId) || (action.startsWith("PARCEL_") && !assignment.parcelBookingId)) {
        throw new ConflictError("Verification action does not match this booking.", "VERIFICATION_ACTION_MISMATCH");
      }
      const ok = await repository.consumeVerification({ assignment, action, tokenHash: hashOpaqueToken(code), actorUserId: user.id });
      if (!ok) throw new ConflictError("The verification code is invalid, expired, or already used.", "INVALID_VERIFICATION_CODE");
      return { assignmentId, status: action === "RIDE_COMPLETION" || action === "PARCEL_DELIVERY" ? "COMPLETED" : "IN_PROGRESS" };
    },
  };
}
