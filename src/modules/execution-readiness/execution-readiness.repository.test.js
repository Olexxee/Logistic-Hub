import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionReadinessRepository } from "./execution-readiness.repository.js";

test("hub occupancy counts packages, not intake records, and preserves missing volume evidence", async () => {
  const repository = createExecutionReadinessRepository({ prismaClient: {} });
  const tx = {
    hubIntakeRecord: {
      findMany: async ({ where, select }) => {
        assert.deepEqual(where, { hubPointId: "hub-1", status: { in: ["RECEIVED", "EXCEPTION"] } });
        assert.ok(select.parcelBooking.select._count.select.parcelPackages);
        return [
          {
            weightGrams: 1200,
            volumeCm3: 1000,
            parcelBooking: { _count: { parcelPackages: 3 } },
          },
          {
            weightGrams: 500,
            volumeCm3: null,
            parcelBooking: { _count: { parcelPackages: 0 } },
          },
        ];
      },
    },
  };
  const result = await repository.getHubLoad(tx, "hub-1");
  assert.equal(result.load._count._all, 4);
  assert.equal(result.load._sum.weightGrams, 1700);
  assert.equal(result.load._sum.volumeCm3, 1000);
  assert.equal(result.missingVolumeCount, 1);
});


test("selected driver revalidation requires the exact vehicle, both route zones and no active assignment", async () => {
  const repository = createExecutionReadinessRepository({ prismaClient: {} });
  const now = new Date("2026-11-13T18:00:00.000Z");
  let query;
  const tx = {
    driverProfile: {
      findFirst: async value => {
        query = value;
        return { id: "driver-1", serviceRadiusMeters: 5000, lastLocationAt: now, locations: [] };
      },
    },
  };
  const leg = {
    type: "FINAL_MILE",
    originServiceZoneId: "zone-origin",
    destinationServiceZoneId: "zone-destination",
  };
  const result = await repository.findEligibleLocalDriver(tx, leg, "driver-1", "vehicle-1", now);
  assert.equal(result.id, "driver-1");
  assert.equal(query.where.id, "driver-1");
  assert.equal(query.where.vehicles.some.id, "vehicle-1");
  assert.equal(query.where.assignments.none.status.in.includes("IN_PROGRESS"), true);
  assert.equal(query.where.AND.length, 2);
});
