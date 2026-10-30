import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryRepository } from "../src/modules/discovery/discovery.repository.js";

test("user search uses bounded safe fields and combines query with role/status filters", async () => {
  let received;
  const prismaClient = {
    user: {
      findMany: async args => { received = args; return []; },
      count: async () => 0,
    },
  };
  const repository = createDiscoveryRepository(prismaClient);
  await repository.searchUsers({ query: "ada", role: "CUSTOMER", status: "ACTIVE", skip: 0, take: 25 });
  assert.deepEqual(received.where, {
    role: "CUSTOMER",
    status: "ACTIVE",
    OR: [
      { fullName: { contains: "ada", mode: "insensitive" } },
      { email: { contains: "ada", mode: "insensitive" } },
      { phone: { contains: "ada" } },
    ],
  });
  assert.equal(received.select.passwordHash, undefined);
  assert.equal(received.select.id, true);
  assert.equal(received.select.emailVerifiedAt, true);
});

test("payment attempt query deliberately excludes provider references and payloads", async () => {
  let received;
  const prismaClient = {
    paymentAttempt: { findUnique: async args => { received = args; return null; } },
  };
  const repository = createDiscoveryRepository(prismaClient);
  await repository.findPaymentAttempt("payment-1");
  assert.equal(received.where.id, "payment-1");
  assert.equal(received.select.providerReference, undefined);
  assert.equal(received.select.providerPayload, undefined);
  assert.equal(received.select.splitConfigurationSnapshot, undefined);
  assert.equal(received.select.parcelBooking.select.senderId, true);
  assert.equal(received.select.rideBooking.select.passengerId, true);
});

test("driver assignment repository scopes to one driver and active assignment statuses", async () => {
  let received;
  const prismaClient = {
    driverAssignment: { findMany: async args => { received = args; return []; } },
  };
  const repository = createDiscoveryRepository(prismaClient);
  await repository.listDriverAssignments({
    driverProfileId: "driver-1", skip: 10, limit: 11, statuses: ["ACCEPTED", "IN_PROGRESS"],
  });
  assert.deepEqual(received.where, { driverProfileId: "driver-1", status: { in: ["ACCEPTED", "IN_PROGRESS"] } });
  assert.equal(received.skip, 10);
  assert.equal(received.take, 11);
});
