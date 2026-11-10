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


test("setting the refresh cookie passes the configured options object to Express", async () => {
  const { setRefreshCookie } = await import("../src/modules/auth/auth-cookie.js");
  const config = getRefreshCookieConfig({ NODE_ENV: "development", APP_STAGE: "staging" });
  let actual;
  const response = {
    cookie(...args) {
      actual = args;
    },
  };

  setRefreshCookie(response, "opaque-refresh-token", config);

  assert.deepEqual(actual, [config.cookieName, "opaque-refresh-token", config.cookieOptions]);
  assert.equal(actual[2].secure, true);
  assert.equal(actual[2].httpOnly, true);
});

test("clearing the refresh cookie preserves scope but omits maxAge", async () => {
  const { clearRefreshCookie } = await import("../src/modules/auth/auth-cookie.js");
  const config = getRefreshCookieConfig({ NODE_ENV: "development", APP_STAGE: "staging" });
  let actual;
  const response = {
    clearCookie(...args) {
      actual = args;
    },
  };

  clearRefreshCookie(response, config);

  assert.equal(actual[0], config.cookieName);
  assert.deepEqual(actual[1], {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  assert.equal("maxAge" in actual[1], false);
});
