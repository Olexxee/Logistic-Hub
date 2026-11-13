import test from "node:test";
import assert from "node:assert/strict";
import { availabilityListSchema } from "./platform-route-pricing.validators.js";
import { createPlatformRoutePricingService } from "./platform-route-pricing.service.js";

test("availability list filters accept only supported directed-route filters", () => {
  assert.equal(availabilityListSchema.safeParse({}).success, true);
  assert.equal(availabilityListSchema.safeParse({
    originServiceZoneId: "origin-zone",
    destinationServiceZoneId: "destination-zone",
    serviceType: "PARCEL_DELIVERY",
  }).success, true);
  assert.equal(availabilityListSchema.safeParse({ serviceType: "PASSENGER_RIDE" }).success, false);
  assert.equal(availabilityListSchema.safeParse({ unexpected: "value" }).success, false);
});

test("lists configured route availability with endpoint zone summaries", async () => {
  let receivedArgs;
  const record = {
    id: "availability-1",
    originServiceZoneId: "origin-zone",
    destinationServiceZoneId: "destination-zone",
    serviceType: "PARCEL_DELIVERY",
    isEnabled: true,
    startsAt: null,
    endsAt: null,
    originServiceZone: { id: "origin-zone", code: "LAG-IKE", name: "Ikeja" },
    destinationServiceZone: { id: "destination-zone", code: "LAG-LEK", name: "Lekki" },
  };
  const service = createPlatformRoutePricingService({
    prismaClient: {
      platformRouteAvailability: {
        findMany: async args => {
          receivedArgs = args;
          return [record];
        },
      },
    },
  });

  const items = await service.listAvailability({
    originServiceZoneId: "origin-zone",
    serviceType: "PARCEL_DELIVERY",
  });

  assert.deepEqual(receivedArgs.where, {
    originServiceZoneId: "origin-zone",
    serviceType: "PARCEL_DELIVERY",
  });
  assert.deepEqual(items[0].origin, record.originServiceZone);
  assert.deepEqual(items[0].destination, record.destinationServiceZone);
  assert.equal(items[0].isEnabled, true);
});
