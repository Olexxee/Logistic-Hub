import test from "node:test";
import assert from "node:assert/strict";
import { createCancellationsRepository } from "../src/modules/cancellations/cancellations.repository.js";

test("customer cancellation history is scoped to actor and includes related refund review state", async () => {
  const expected = [{ id: "event-1", eventType: "CANCELLATION_REVIEW_REQUESTED", parcelBooking: { publicReference: "LH-PCL-1", refunds: [{ status: "PENDING_REVIEW" }] }, rideBooking: null }];
  let args;
  const prismaClient = { bookingEvent: { findMany: async input => { args = input; return expected; } } };
  const repo = createCancellationsRepository(prismaClient);
  const result = await repo.listMine({ userId: "customer-1", cursor: "event-0", limit: 10 });
  assert.deepEqual(result, expected);
  assert.deepEqual(args.where, { actorUserId: "customer-1", eventType: { in: ["BOOKING_CANCELLED", "CANCELLATION_REVIEW_REQUESTED"] } });
  assert.deepEqual(args.cursor, { id: "event-0" });
  assert.equal(args.take, 11);
  assert.equal(args.select.parcelBooking.select.refunds.where.requestedByUserId, "customer-1");
  assert.equal(args.select.rideBooking.select.refunds.where.requestedByUserId, "customer-1");
});
