import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBootstrapArguments,
  validateStagingAdminBootstrapConfig,
} from "../scripts/bootstrap-staging-admin.js";

const validEnvironment = () => ({
  APP_STAGE: "staging",
  NODE_ENV: "development",
  DATABASE_URL: "postgres://staging-user:staging-password@db.prisma.io:5432/postgres?sslmode=require",
  STAGING_ADMIN_EMAIL: "Admin@Example.com",
  STAGING_ADMIN_FULL_NAME: "Staging Administrator",
  STAGING_ADMIN_PASSWORD: "a-long-staging-only-password",
});

test("staging Admin bootstrap defaults to dry-run", () => {
  assert.deepEqual(parseBootstrapArguments([]), {
    apply: false,
    confirmedDatabase: null,
  });
});

test("staging Admin bootstrap requires explicit apply and exact database confirmation", () => {
  assert.deepEqual(parseBootstrapArguments(["--apply", "--confirm-staging-database=postgres"]), {
    apply: true,
    confirmedDatabase: "postgres",
  });
  assert.throws(
    () => validateStagingAdminBootstrapConfig(validEnvironment(), ["--apply"]),
    /requires --confirm-staging-database=postgres/,
  );
});

test("staging Admin bootstrap rejects non-staging environments", () => {
  const environment = validEnvironment();
  environment.APP_STAGE = "production";
  assert.throws(() => validateStagingAdminBootstrapConfig(environment), /APP_STAGE=staging/);
});

test("staging Admin bootstrap rejects production runtime mode", () => {
  const environment = validEnvironment();
  environment.NODE_ENV = "production";
  assert.throws(() => validateStagingAdminBootstrapConfig(environment), /NODE_ENV=development/);
});

test("staging Admin bootstrap rejects any database host other than the dedicated staging host", () => {
  const environment = validEnvironment();
  environment.DATABASE_URL = "postgres://user:password@pooled.db.prisma.io:5432/postgres";
  assert.throws(() => validateStagingAdminBootstrapConfig(environment), /dedicated staging database host/);
});

test("staging Admin bootstrap rejects a different database name", () => {
  const environment = validEnvironment();
  environment.DATABASE_URL = "postgres://user:password@db.prisma.io:5432/production";
  assert.throws(() => validateStagingAdminBootstrapConfig(environment), /expected staging database name/);
});

test("staging Admin bootstrap normalizes email and validates credentials", () => {
  const config = validateStagingAdminBootstrapConfig(validEnvironment());
  assert.equal(config.admin.email, "admin@example.com");
  assert.equal(config.admin.fullName, "Staging Administrator");
  assert.equal(config.database.host, "db.prisma.io");
  assert.equal(config.database.name, "postgres");
});

test("staging Admin bootstrap rejects weak passwords", () => {
  const environment = validEnvironment();
  environment.STAGING_ADMIN_PASSWORD = "too-short";
  assert.throws(() => validateStagingAdminBootstrapConfig(environment), /16–128 characters/);
});

test("staging Admin bootstrap rejects unknown arguments", () => {
  assert.throws(() => parseBootstrapArguments(["--force"]), /Unknown argument/);
});
