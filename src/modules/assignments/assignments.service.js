import { createHash, randomInt } from "node:crypto";
import { createAssignmentsRepository } from "./assignments.repository.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/http/app-error.js";


export function createAssignmentsService({
  prismaClient,
  clock = () => new Date(),
}) {
  const repository = createAssignmentsRepository(prismaClient);
  return {
    async markArrived({ assignmentId, userId }) {
      const a = await repository.findAssignment(assignmentId);
      if (!a) throw new NotFoundError("Assignment not found.");
      if (a.driverProfile.userId !== userId) throw new ForbiddenError();
      const result = await repository.transition({
        assignmentId,
        driverUserId: userId,
        nextStatus: "ARRIVED_AT_PICKUP",
        now: clock(),
      });
      if (result?.conflict)
        throw new ConflictError(
          "Assignment is not in a state that allows arrival at pickup.",
          "ASSIGNMENT_STATE_CONFLICT",
        );
      if (result?.forbidden) throw new ForbiddenError();
      return result;
      },
      
    async startTrip({ assignmentId, userId }) {
      const a = await repository.findAssignment(assignmentId);
      if (!a) throw new NotFoundError("Assignment not found.");
      if (a.driverProfile.userId !== userId) throw new ForbiddenError();
      const result = await repository.transition({
        assignmentId,
        driverUserId: userId,
        nextStatus: "IN_PROGRESS",
        now: clock(),
      });
      if (result?.conflict)
        throw new ConflictError(
          "Pickup must be verified before starting the trip.",
          "ASSIGNMENT_STATE_CONFLICT",
        );
      if (result?.forbidden) throw new ForbiddenError();
      return result;
    },
    async markDestination({ assignmentId, userId }) {
      const a = await repository.findAssignment(assignmentId);
      if (!a) throw new NotFoundError("Assignment not found.");
      if (a.driverProfile.userId !== userId) throw new ForbiddenError();
      const result = await repository.transition({
        assignmentId,
        driverUserId: userId,
        nextStatus: "ARRIVED_AT_DESTINATION",
        now: clock(),
      });
      if (result?.conflict)
        throw new ConflictError(
          "Pickup must be verified and the trip started before arriving at destination.",
          "ASSIGNMENT_STATE_CONFLICT",
        );
      if (result?.forbidden) throw new ForbiddenError();
      return result;
    },
    async issueCode({ assignmentId, user, action }) {
      const a = await repository.findAssignment(assignmentId);
      if (!a) throw new NotFoundError("Assignment not found.");
      const booking = a.parcelBooking || a.rideBooking;
      const ownerId = a.parcelBooking ? booking.senderId : booking.passengerId;
      if (user.id !== ownerId)
        throw new ForbiddenError(
          "Only the booking owner can request a verification code.",
        );
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      const result = await repository.issueCode({
        assignment: a,
        action,
        tokenHash: createHash("sha256").update(code).digest("hex"),
        expiresAt: new Date(clock().getTime() + 10 * 60_000),
        now: clock(),
      });
      if (!result) throw new ConflictError("Assignment is no longer active.");
      if (result.conflict)
        throw new ConflictError(
          "The driver must arrive at the relevant stop before a code can be issued.",
          "ASSIGNMENT_STATE_CONFLICT",
        );
      return {
        assignmentId,
        action,
        code,
        expiresInSeconds: 600,
        note: "Share this one-time code only with your assigned driver.",
      };
    },
    async verifyCode({ assignmentId, userId, action, code }) {
      const result = await repository.verifyCode({
        assignmentId,
        driverUserId: userId,
        action,
        tokenHash: createHash("sha256").update(code).digest("hex"),
        now: clock(),
      });
      if (!result) throw new NotFoundError("Assignment not found.");
      if (result.forbidden) throw new ForbiddenError();
      if (result.invalid)
        throw new ConflictError(
          "The verification code is invalid or expired.",
          "INVALID_VERIFICATION_CODE",
        );
      if (result.conflict)
        throw new ConflictError(
          "Assignment is not in the state required for this verification.",
          "ASSIGNMENT_STATE_CONFLICT",
        );
      return result;
    },
    async location({ assignmentId, user }) {
      const a = await repository.findAssignment(assignmentId);
      if (!a) throw new NotFoundError("Assignment not found.");
      const booking = a.parcelBooking || a.rideBooking;
      const ownerId = a.parcelBooking ? booking.senderId : booking.passengerId;
      if (user.id !== ownerId && !["ADMIN", "SUPPORT"].includes(user.role))
        throw new ForbiddenError();
      if (
        ![
          "ACCEPTED",
          "ARRIVED_AT_PICKUP",
          "PICKUP_CONFIRMED",
          "IN_PROGRESS",
          "ARRIVED_AT_DESTINATION",
        ].includes(a.status)
      )
        throw new ConflictError(
          "Driver location is visible only during an active, paid assignment.",
          "TRACKING_NOT_AVAILABLE",
        );
      const loc = await repository.findOwnerLocation({
        assignment: a,
        now: clock(),
      });
      return loc
        ? {
            latitude: loc.latitude.toString(),
            longitude: loc.longitude.toString(),
            accuracyMeters: loc.accuracyMeters?.toString() ?? null,
            recordedAt: loc.recordedAt,
          }
        :null;
    },
  };
}
