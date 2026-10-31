import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimitRepository } from "../src/shared/http/rate-limit.repository.js";

test("rate limiter atomically counts concurrent requests and enforces the limit", async () => {
  let count = 0;
  let receivedQuery;
  const windowEndsAt = new Date(Date.now() + 60_000);
  const prismaClient = {
    $queryRaw: async (strings, ...values) => {
      receivedQuery = { sql: strings.join("?"), values };
      count += 1;
      return [{ count, windowEndsAt }];
    },
  };
  const repository = createRateLimitRepository(prismaClient);
  const input = {
    key: "register:client-hash:window",
    windowStartedAt: new Date(Date.now() - 1_000),
    windowEndsAt,
    limit: 5,
  };

  const results = await Promise.all(
    Array.from({ length: 20 }, () => repository.consume(input)),
  );

  assert.equal(results.filter((result) => result.allowed).length, 5);
  assert.equal(results.filter((result) => !result.allowed).length, 15);
  assert.equal(results.at(-1).remaining, 0);
  assert.match(receivedQuery.sql, /INSERT INTO "rate_limit_buckets"/);
  assert.match(receivedQuery.sql, /ON CONFLICT \("key"\) DO UPDATE/);
  assert.match(receivedQuery.sql, /"count" \+ 1/);
  assert.equal(receivedQuery.values[0], input.key);
});

test("rate limiter returns the remaining count and a positive retry interval", async () => {
  const windowEndsAt = new Date(Date.now() + 10_000);
  const prismaClient = {
    $queryRaw: async () => [{ count: 3, windowEndsAt }],
  };
  const repository = createRateLimitRepository(prismaClient);

  const result = await repository.consume({
    key: "login:client-hash:window",
    windowStartedAt: new Date(Date.now() - 1_000),
    windowEndsAt,
    limit: 10,
  });

  assert.deepEqual(
    { allowed: result.allowed, remaining: result.remaining },
    { allowed: true, remaining: 7 },
  );
  assert.ok(result.retryAfterSeconds > 0);
});
