import { randomInt } from "node:crypto";
import { hashOpaqueToken } from "../auth/auth.crypto.js";
import { createAssignmentsRepository } from "./assignments.repository.js";
import { ForbiddenError, NotFoundError, ConflictError } from "../../shared/http/app-error.js";

const ACTIVE_STATUSES = new Set(["ACCEPTED", "ARRIVED_AT_PICKUP", "PICKUP_CONFIRMED", "IN_PROGRESS", "ARRIVED_AT_DESTINATION"]);
const ACTIONS = new Set(["RIDE_PICKUP", "RIDE_COMPLETION", "PARCEL_PICKUP", "PARCEL_DELIVERY"]);

export function createAssignmentsService({ prismaClient, repository, clock = () => new Date() }) {
  const db = repository ?? createAssignmentsRepository({ prismaClient });

  async function requireContext(id) {
    const assignment = await db.findContext(id);
    if (!assignment) throw new NotFoundError("The assignment was not found.");
    if (Boolean(assignment.rideBookingId) === Boolean(assignment.parcelBookingId)) {
      throw new ConflictError("The assignment has an invalid booking association.", "ASSIGNMENT_BOOKING_INVALID");
    }
    return assignment;
  }
  function isCustomer(assignment, userId) {
    return assignment.rideBooking ? assignment.rideBooking.passengerId === userId : assignment.parcelBooking.senderId === userId;
  }
  function isDriver(assignment, userId) {
    return assignment.driverProfile.userId === userId;
  }

  return {
    async issueVerificationCode({ assignmentId, user }) {
      const assignment = await requireContext(assignmentId);
      if (!isCustomer(assignment, user.id)) throw new ForbiddenError("Only the booking customer can request a verification code.");
      if (assignment.paymentStatus !== "SUCCEEDED" && (assignment.rideBooking?.paymentStatus ?? assignment.parcelBooking?.paymentStatus) !== "SUCCEEDED") {
        throw new ConflictError("Verification codes are available only after payment is confirmed.", "PAYMENT_NOT_CONFIRMED");
      }
      let action;
      if (assignment.rideBooking) {
        if (assignment.status === "ARRIVED_AT_PICKUP") action = "RIDE_PICKUP";
        else if (assignment.status === "ARRIVED_AT_DESTINATION") action = "RIDE_COMPLETION";
      } else {
        if (assignment.status === "ARRIVED_AT_PICKUP") action = "PARCEL_PICKUP";
        else if (assignment.status === "ARRIVED_AT_DESTINATION") action = "PARCEL_DELIVERY";
      }
      if (!action) throw new ConflictError("A verification code is not available at this assignment stage.", "VERIFICATION_STAGE_INVALID");
      const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
      const now = clock();
      const token = await db.createVerification({
        assignment,
        action,
        tokenHash: hashOpaqueToken(code),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });
      return { assignmentId, action, code, expiresAt: token.expiresAt };
    },

    async markArrivedAtPickup({ assignmentId, user }) {
      const assignment = await requireContext(assignmentId);
      if (!isDriver(assignment, user.id)) throw new ForbiddenError("Only the assigned driver can update this assignment.");
      if (assignment.paymentStatus !== "SUCCEEDED" && (assignment.rideBooking?.paymentStatus ?? assignment.parcelBooking?.paymentStatus) !== "SUCCEEDED") {
        throw new ConflictError("The assignment cannot start before payment is confirmed.", "PAYMENT_NOT_CONFIRMED");
      }
      const changed = await db.markArrivedAtPickup({ assignment, actorUserId: user.id, now: clock() });
      if (!changed) throw new ConflictError("The assignment is not awaiting pickup.", "ASSIGNMENT_STATE_CONFLICT");
      return { assignmentId, status: "ARRIVED_AT_PICKUP" };
    },

    async verifyCode({ assignmentId, code, user }) {
      const assignment = await requireContext(assignmentId);
      if (!isDriver(assignment, user.id)) throw new ForbiddenError("Only the assigned driver can verify this code.");
      if (!/^[0-9]{8}$/.test(code)) throw new ConflictError("The verification code is invalid or expired.", "INVALID_VERIFICATION_CODE");
      let action;
      if (assignment.rideBooking && assignment.status === "ARRIVED_AT_PICKUP") action = "RIDE_PICKUP";
      else if (assignment.rideBooking && assignment.status === "ARRIVED_AT_DESTINATION") action = "RIDE_COMPLETION";
      else if (assignment.parcelBooking && assignment.status === "ARRIVED_AT_PICKUP") action = "PARCEL_PICKUP";
      else if (assignment.parcelBooking && assignment.status === "ARRIVED_AT_DESTINATION") action = "PARCEL_DELIVERY";
      if (!action) throw new ConflictError("The assignment is not awaiting verification.", "VERIFICATION_STAGE_INVALID");
      const result = await db.consumeCodeAndTransition({
        assignment,
        tokenHash: hashOpaqueToken(code),
        action,
        actorUserId: user.id,
        now: clock(),
      });
      if (!result.ok) throw new ConflictError("The verification code is invalid, expired, or no longer applicable.", result.reason);
      return { assignmentId, status: result.status };
    },

    async markArrivedAtDestination({ assignmentId, user }) {
      const assignment = await requireContext(assignmentId);
      if (!isDriver(assignment, user.id)) throw new ForbiddenError("Only the assigned driver can update this assignment.");
      if (!ACTIVE_STATUSES.has(assignment.status) || assignment.status !== "IN_PROGRESS") {
        throw new ConflictError("The assignment is not in progress.", "ASSIGNMENT_STATE_CONFLICT");
      }
      const changed = await db.markArrivedAtDestination({ assignment, actorUserId: user.id, now: clock() });
      if (!changed) throw new ConflictError("The assignment changed before the update could be applied.", "ASSIGNMENT_STATE_CONFLICT");
      return { assignmentId, status: "ARRIVED_AT_DESTINATION" };
    },

    async getVisibleLocation({ assignmentId, user }) {
      const assignment = await requireContext(assignmentId);
      if (!isDriver(assignment, user.id) && !isCustomer(assignment, user.id)) {
        throw new ForbiddenError("You do not have permission to view this driver's location.");
      }
      if (!ACTIVE_STATUSES.has(assignment.status)) {
        throw new ConflictError("Driver location is available only during an active assignment.", "LOCATION_NOT_AVAILABLE");
      }
      const location = await db.latestLocation(assignment.driverProfileId);
      if (!location || clock().getTime() - new Date(location.recordedAt).getTime() > 2 * 60 * 1000) return null;
      return {
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        accuracyMeters: location.accuracyMeters == null ? null : String(location.accuracyMeters),
        recordedAt: location.recordedAt,
      };
    },
  };
}
