import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHubApplicationsRouter } from "../src/modules/hub-applications/hub-applications.routes.js";
import { requireRole } from "../src/modules/auth/auth.middleware.js";
import { errorHandler } from "../src/shared/http/error-handler.js";

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function createApp(prismaClient) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createHubApplicationsRouter({
    prismaClient,
    authMiddleware: (req, _res, next) => {
      req.user = { id: "user-1", role: req.get("x-user-role") ?? "CUSTOMER" };
      next();
    },
    roleMiddleware: requireRole,
  }));
  app.use(errorHandler);
  return app;
}

test("hub application administration rejects non-admin users", async () => {
  const prismaClient = { hubApplication: { findMany: async () => [] } };
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/admin/hub-applications`, {
      headers: { "x-user-role": "SUPPORT" },
    });
    assert.equal(response.status, 403);
  });
});

test("partner application history is limited to the authenticated applicant", async () => {
  let where;
  const prismaClient = {
    hubApplication: {
      findMany: async args => { where = args.where; return []; },
    },
  };
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/partner/hub-applications`);
    assert.equal(response.status, 200);
    assert.deepEqual(where, { applicantUserId: "user-1" });
  });
});

test("hub application submission rejects unknown fields and incomplete payloads", async () => {
  const prismaClient = {};
  await withServer(createApp(prismaClient), async base => {
    const response = await fetch(`${base}/api/v1/partner/hub-applications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: "partner-1", unexpected: true }),
    });
    assert.equal(response.status, 400);
  });
});
