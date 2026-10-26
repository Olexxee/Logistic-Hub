import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/logistic_hub?schema=public";
process.env.PAYMENTS_ENABLED ??= "false";
process.env.NODE_ENV = "test";

const { app } = await import("../src/app.js");

test("root describes the versioned health endpoint", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.health, "/api/v1/health");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("health endpoint reports payments disabled by default", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, "ok");
    assert.equal(body.data.paymentsEnabled, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("unknown routes use the standard error envelope", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/not-a-route`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "ROUTE_NOT_FOUND");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("payment activation is rejected until owner approval", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'import("./src/config/env.js")'],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/logistic_hub?schema=public",
        PAYMENTS_ENABLED: "true",
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked until the project owner explicitly approves/);
});
