import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createHubPointsService } from "../src/modules/hub-points/hub-points.service.js";
import { createServiceZonesService } from "../src/modules/geography/service-zones.service.js";

const enabled = process.env.RUN_POSTGRES_INTEGRITY_TESTS === "true";
const prisma = new PrismaClient();

test.after(async () => prisma.$disconnect());

test("public geography and hub discovery expose only currently eligible operational locations", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const countryCode = `Q${String.fromCharCode(65 + (parseInt(suffix.slice(0, 2), 16) % 26))}`;
  let country;
  let state;
  let zone;
  let availability;
  let hub;

  try {
    country = await prisma.country.create({
      data: { code: countryCode, name: `Hub Test Country ${suffix}`, isActive: true },
    });
    state = await prisma.state.create({
      data: { countryId: country.id, code: `S${suffix}`, name: `Hub Test State ${suffix}`, isActive: true },
    });
    zone = await prisma.serviceZone.create({
      data: { stateId: state.id, code: `Z${suffix}`, name: `Hub Test Zone ${suffix}`, isActive: true },
    });
    availability = await prisma.serviceAvailability.create({
      data: { serviceZoneId: zone.id, serviceType: "PARCEL_DELIVERY", isEnabled: true },
    });
    hub = await prisma.hubPoint.create({
      data: {
        serviceZoneId: zone.id,
        name: `Active Hub ${suffix}`,
        address: "Test operational address",
        latitude: 6.5244,
        longitude: 3.3792,
        status: "ACTIVE",
      },
    });

    const zones = await createServiceZonesService({ prismaClient: prisma }).listActive({
      countryCode,
      serviceType: "PARCEL_DELIVERY",
    });
    assert.ok(zones.some((item) => item.id === zone.id));

    const hubs = await createHubPointsService({ prismaClient: prisma }).listActive({
      countryCode,
      limit: 50,
    });
    assert.ok(hubs.data.some((item) => item.id === hub.id));

    await prisma.serviceAvailability.update({
      where: { id: availability.id },
      data: { isEnabled: false },
    });

    const unavailableZones = await createServiceZonesService({ prismaClient: prisma }).listActive({
      countryCode,
      serviceType: "PARCEL_DELIVERY",
    });
    assert.equal(unavailableZones.some((item) => item.id === zone.id), false);

    const unavailableHubs = await createHubPointsService({ prismaClient: prisma }).listActive({
      countryCode,
      limit: 50,
    });
    assert.equal(unavailableHubs.data.some((item) => item.id === hub.id), false);
  } finally {
    if (hub) await prisma.hubPoint.deleteMany({ where: { id: hub.id } });
    if (availability) await prisma.serviceAvailability.deleteMany({ where: { id: availability.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});
