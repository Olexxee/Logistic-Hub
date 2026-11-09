import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { createDriversService } from "../src/modules/drivers/drivers.service.js";
import { createDriversRouter } from "../src/modules/drivers/drivers.routes.js";
import { createPartnerPricingRouter } from "../src/modules/partner-pricing/partner-pricing.routes.js";

const enabled = process.env.RUN_POSTGRES_INTEGRITY_TESTS === "true";
const prisma = new PrismaClient();

test.after(async () => prisma.$disconnect());

function tag() {
  return randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}

test("driver eligibility requires verified profile, verified vehicle, and currently active geographic coverage", { skip: !enabled }, async () => {
  const suffix = tag();
  let country;
  let state;
  let zone;
  let availability;
  let user;
  let reviewerUser;
  let profile;
  let vehicle;
  let server;

  const service = createDriversService({ prismaClient: prisma });

  try {
    country = await prisma.country.create({ data: { code: `T${suffix.slice(0, 1)}`, name: `Priority 3 Country ${suffix}`, isActive: false } });
    state = await prisma.state.create({ data: { countryId: country.id, code: `S${suffix}`, name: `Priority 3 State ${suffix}`, isActive: false } });
    zone = await prisma.serviceZone.create({ data: { stateId: state.id, code: `Z${suffix}`, name: `Priority 3 Zone ${suffix}`, isActive: true } });
    availability = await prisma.serviceAvailability.create({
      data: { serviceZoneId: zone.id, serviceType: "PARCEL_DELIVERY", isEnabled: true },
    });
    user = await prisma.user.create({ data: { fullName: `Priority 3 Driver ${suffix}` } });
    reviewerUser = await prisma.user.create({ data: { fullName: `Priority 3 Admin ${suffix}`, role: "ADMIN" } });
    profile = await prisma.driverProfile.create({
      data: { userId: user.id, verificationStatus: "PENDING", isOnline: false, isAvailable: false },
    });
    vehicle = await prisma.vehicle.create({
      data: { driverProfileId: profile.id, type: "MOTORCYCLE", verificationStatus: "PENDING", isActive: false },
    });

    await assert.rejects(
      service.setCoverage({
        input: {
          driverProfileId: profile.id,
          serviceZoneId: zone.id,
          serviceType: "PARCEL_DELIVERY",
          isEnabled: true,
          reason: "Integration test coverage assignment attempt.",
        },
        actorUserId: reviewerUser.id,
      }),
      (error) => error.code === "SERVICE_ZONE_NOT_ELIGIBLE",
    );

    await prisma.country.update({ where: { id: country.id }, data: { isActive: true } });
    await prisma.state.update({ where: { id: state.id }, data: { isActive: true } });
    const coverage = await service.setCoverage({
      input: {
        driverProfileId: profile.id,
        serviceZoneId: zone.id,
        serviceType: "PARCEL_DELIVERY",
        isEnabled: true,
        reason: "Integration test coverage assignment approval.",
      },
      actorUserId: reviewerUser.id,
    });
    assert.equal(coverage.isEnabled, true);

    await assert.rejects(
      service.setAvailability({ userId: user.id, input: { isOnline: true, isAvailable: true } }),
      (error) => error.statusCode === 403,
    );

    await service.reviewDriver({ driverProfileId: profile.id, verificationStatus: "VERIFIED", reason: "Integration test driver verification approval", actorUserId: reviewerUser.id });
    await assert.rejects(
      service.setAvailability({ userId: user.id, input: { isOnline: true, isAvailable: true } }),
      (error) => error.code === "DRIVER_NOT_READY",
    );

    await service.reviewVehicle({ vehicleId: vehicle.id, verificationStatus: "VERIFIED", reason: "Integration test vehicle verification approval", actorUserId: reviewerUser.id });
    await prisma.serviceAvailability.update({ where: { id: availability.id }, data: { isEnabled: false } });
    await assert.rejects(
      service.setAvailability({ userId: user.id, input: { isOnline: true, isAvailable: true } }),
      (error) => error.code === "DRIVER_NOT_READY",
    );

    await prisma.serviceAvailability.update({ where: { id: availability.id }, data: { isEnabled: true } });
    const online = await service.setAvailability({
      userId: user.id,
      input: { isOnline: true, isAvailable: true },
    });
    assert.equal(online.isOnline, true);
    assert.equal(online.isAvailable, true);

    const location = await service.recordLocation({
      userId: user.id,
      input: { latitude: 6.5244, longitude: 3.3792, accuracyMeters: 15 },
    });
    assert.equal(location.latitude, "6.5244");
    assert.equal(location.longitude, "3.3792");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (profile) await prisma.driverLocation.deleteMany({ where: { driverProfileId: profile.id } });
    if (profile) await prisma.driverCoverage.deleteMany({ where: { driverProfileId: profile.id } });
    if (vehicle) await prisma.vehicle.deleteMany({ where: { id: vehicle.id } });
    if (profile) await prisma.driverProfile.deleteMany({ where: { id: profile.id } });
    if (reviewerUser) await prisma.user.deleteMany({ where: { id: reviewerUser.id } });
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    if (availability) await prisma.serviceAvailability.deleteMany({ where: { id: availability.id } });
    if (zone) await prisma.serviceZone.deleteMany({ where: { id: zone.id } });
    if (state) await prisma.state.deleteMany({ where: { id: state.id } });
    if (country) await prisma.country.deleteMany({ where: { id: country.id } });
  }
});

test("transport partner administration rejects authenticated non-admin users", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createPartnerPricingRouter({
    prismaClient: {},
    authMiddleware: (req, _res, next) => {
      req.user = { id: "customer-user", role: "CUSTOMER" };
      next();
    },
    adminMiddleware: (req, res, next) => {
      if (req.user?.role !== "ADMIN") {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Administrator access is required." },
        });
      }
      return next();
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/admin/transport-partners`);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("driver operational and administrative routes enforce role authorization", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/drivers", createDriversRouter({
    prismaClient: {},
    email: { configured: false },
    authMiddleware: (req, _res, next) => {
      req.user = { id: "customer-user", role: "CUSTOMER" };
      next();
    },
    roleMiddleware: (...roles) => (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "You do not have permission." },
        });
      }
      return next();
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1/drivers`;
    const availability = await fetch(`${baseUrl}/availability`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isOnline: true, isAvailable: true }),
    });
    assert.equal(availability.status, 403);

    const review = await fetch(`${baseUrl}/admin/profile-id/verification`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verificationStatus: "VERIFIED" }),
    });
    assert.equal(review.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
