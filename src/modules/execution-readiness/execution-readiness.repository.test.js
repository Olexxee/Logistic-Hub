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
