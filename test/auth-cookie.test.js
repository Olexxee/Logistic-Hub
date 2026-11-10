import test from "node:test";
import assert from "node:assert/strict";
import { getRefreshCookieConfig } from "../src/modules/auth/auth-cookie.js";

test("local development keeps the non-secure local refresh cookie", () => {
  const config = getRefreshCookieConfig({ NODE_ENV: "development", APP_STAGE: "local" });
  assert.equal(config.cookieName, "lh_refresh");
  assert.equal(config.cookieOptions.secure, false);
  assert.equal(config.cookieOptions.httpOnly, true);
  assert.equal(config.cookieOptions.sameSite, "lax");
  assert.equal(config.cookieOptions.path, "/");
});

test("staging uses a Secure __Host- prefixed refresh cookie without production NODE_ENV", () => {
  const config = getRefreshCookieConfig({ NODE_ENV: "development", APP_STAGE: "staging" });
  assert.equal(config.cookieName, "__Host-lh_refresh");
  assert.equal(config.cookieOptions.secure, true);
  assert.equal(config.cookieOptions.httpOnly, true);
  assert.equal(config.cookieOptions.sameSite, "lax");
  assert.equal(config.cookieOptions.path, "/");
  assert.equal("domain" in config.cookieOptions, false);
});

test("production remains Secure and uses the __Host- refresh cookie", () => {
  const config = getRefreshCookieConfig({ NODE_ENV: "production", APP_STAGE: "production" });
  assert.equal(config.cookieName, "__Host-lh_refresh");
  assert.equal(config.cookieOptions.secure, true);
});
