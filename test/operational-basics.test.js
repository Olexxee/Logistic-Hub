import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHealthRouter } from "../src/modules/health/health.routes.js";
import { createServiceZonesRouter } from "../src/modules/geography/service-zones.routes.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("database readiness returns ready when PostgreSQL responds", async () => {
  const app = express();
  app.use("/health", createHealthRouter({ prismaClient: { $queryRaw: async () => [{ "?column?": 1 }] } }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.status, "ready");
    assert.equal(body.data.dependencies.database.status, "ok");
  });
});

test("database readiness returns a safe 503 when PostgreSQL is unavailable", async () => {
  const app = express();
  app.use("/health", createHealthRouter({ prismaClient: { $queryRaw: async () => { throw new Error("secret connection details"); } } }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "DEPENDENCY_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(body), /secret connection details/);
  });
});

test("service-zone endpoint returns active zones from the service layer", async () => {
  const expected = [{
    id: "zone_1",
    code: "LAG-TEST",
    name: "Test Zone",
    state: { code: "NG-LA", name: "Lagos", country: { code: "NG", name: "Nigeria" } },
    lga: { code: "TEST", name: "Test LGA" },
    availability: [{ serviceType: "PARCEL_DELIVERY", isEnabled: true, startsAt: null, endsAt: null }],
  }];
  let queryReceived;
  const prismaClient = {
    serviceZone: {
      findMany: async (query) => { queryReceived = query; return expected; },
    },
  };
  const app = express();
  app.use("/zones", createServiceZonesRouter({ prismaClient }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/zones?countryCode=NG&serviceType=PARCEL_DELIVERY`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data[0].services[0].serviceType, "PARCEL_DELIVERY");
    assert.equal(queryReceived.where.state.country.code, "NG");
    assert.equal(queryReceived.where.availability.some.serviceType, "PARCEL_DELIVERY");
  });
});

test("service-zone endpoint rejects malformed filters", async () => {
  const app = express();
  app.use("/zones", createServiceZonesRouter({ prismaClient: { serviceZone: { findMany: async () => [] } } }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/zones?countryCode=nigeria`);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
  });
});
