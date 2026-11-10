import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const moduleUrl = new URL("../src/config/env.js", import.meta.url).href;

function loadConfig(overrides = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl)})`], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:password@localhost:5432/logistic_hub",
      CORS_ORIGINS: "",
      ...overrides,
    },
  });
}

test("accepts exact comma-separated browser origins", () => {
  const result = loadConfig({ CORS_ORIGINS: "https://app.example.com,https://admin.example.com:8443" });
  assert.equal(result.status, 0, result.stderr);
});

test("rejects CORS entries containing paths", () => {
  const result = loadConfig({ CORS_ORIGINS: "https://app.example.com/dashboard" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CORS_ORIGINS/);
});

test("rejects wildcard CORS origins", () => {
  const result = loadConfig({ CORS_ORIGINS: "*" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CORS_ORIGINS/);
});

test("rejects non-HTTPS browser origins in production", () => {
  const result = loadConfig({
    NODE_ENV: "production",
    APP_STAGE: "production",
    DRIVER_KYC_MODE: "STRICT",
    CORS_ORIGINS: "http://app.example.com",
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "test-key",
    RESEND_FROM_EMAIL: "noreply@example.com",
    OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    JWT_ACCESS_SECRET: "a".repeat(40),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production CORS_ORIGINS entries must use HTTPS/);
});
