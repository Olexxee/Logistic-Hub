import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsControlService } from "../src/modules/operations-control/operations-control.service.js";

const now = new Date("2026-10-31T12:00:00.000Z");

function prismaWithCounts(counts = {}) {
  const calls = [];
  const model = name => ({
    count: async args => {
      calls.push({ model: name, args });
      return counts[name] ?? 0;
    },
  });
  return {
    calls,
    parcelBooking: model("parcelBooking"),
    deliveryLeg: model("deliveryLeg"),
    custodyHandover: model("custodyHandover"),
    hubIntakeRecord: model("hubIntakeRecord"),
    operationalCase: model("operationalCase"),
    partnerDeliveryAssignment: model("partnerDeliveryAssignment"),
  };
}

test("operations overview returns bounded aggregate metrics without exposing shipment records", async () => {
  const prismaClient = prismaWithCounts({
    parcelBooking: 12,
    deliveryLeg: 8,
    custodyHandover: 3,
    hubIntakeRecord: 2,
    operationalCase: 5,
    partnerDeliveryAssignment: 4,
  });
  const service = createOperationsControlService({ prismaClient, clock: () => now });
  const result = await service.getOverview();

  assert.equal(result.generatedAt, now.toISOString());
  assert.deepEqual(result.metrics, {
    activeShipments: 12,
    activeDeliveryLegs: 8,
    failedDeliveryLegs: 8,
    pendingCustodyHandovers: 3,
    hubIntakeExceptions: 2,
    activeOperationalCases: 5,
    criticalOperationalCases: 5,
    unassignedOperationalCases: 5,
    activePartnerAssignments: 4,
  });
  assert.equal(prismaClient.calls.length, 9);
  assert.equal(prismaClient.calls.some(call => call.model === "parcelBooking" && call.args.where.status.in.includes("DRAFT")), false);
  assert.equal(prismaClient.calls.some(call => call.model === "deliveryLeg" && call.args.where.status === "FAILED"), true);
  assert.equal(prismaClient.calls.some(call => call.model === "operationalCase" && call.args.where.assignedToUserId === null), true);
});
