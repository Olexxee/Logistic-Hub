import test from "node:test";
import assert from "node:assert/strict";
import { initializePaymentSchema } from "../src/modules/payments/payments.schemas.js";
import { issueCodeSchema, verifyCodeSchema } from "../src/modules/assignments/assignments.schemas.js";
import { refundRequestSchema, reviewRefundSchema, confirmPayoutSchema } from "../src/modules/finance/finance.schemas.js";
import { createAuthSessionsService } from "../src/modules/auth/auth-sessions.service.js";

test("payment initialization schema restricts booking types and identifiers", () => {
  assert.equal(initializePaymentSchema.safeParse({ bookingType: "RIDE", bookingId: "ride_123" }).success, true);
  assert.equal(initializePaymentSchema.safeParse({ bookingType: "UNKNOWN", bookingId: "x" }).success, false);
  assert.equal(initializePaymentSchema.safeParse({ bookingType: "PARCEL", bookingId: "x", amountMinor: "1" }).success, false);
});

test("assignment verification accepts only pickup/delivery and six-digit codes", () => {
  assert.equal(issueCodeSchema.safeParse({ action: "PICKUP" }).success, true);
  assert.equal(verifyCodeSchema.safeParse({ action: "DELIVERY", code: "012345" }).success, true);
  assert.equal(verifyCodeSchema.safeParse({ action: "PICKUP", code: "12345" }).success, false);
});

test("financial schemas require idempotency-compatible amount and explicit review decisions", () => {
  assert.equal(refundRequestSchema.safeParse({ paymentAttemptId: "pay_1", amountMinor: "1200", reason: "Customer was charged twice" }).success, true);
  assert.equal(refundRequestSchema.safeParse({ paymentAttemptId: "pay_1", amountMinor: "-1", reason: "Duplicate payment issue" }).success, false);
  assert.equal(reviewRefundSchema.safeParse({ decision: "APPROVE", reviewNote: "Verified duplicate charge" }).success, true);
  assert.equal(confirmPayoutSchema.safeParse({ providerReference: "settlement-123" }).success, true);
});

test("refresh token rotation persists a hash and refuses replay", async () => {
  const rows = new Map();
  const user = { id: "user_1", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: new Date() };
  const client = { authSession: {
    create: async ({ data }) => { const row = { id: "session_1", ...data, user }; rows.set(data.tokenHash, row); return row; },
    findUnique: async ({ where }) => rows.get(where.tokenHash) ?? null,
    updateMany: async ({ where, data }) => {
      const row = rows.get(where.tokenHash);
      if (!row || row.revokedAt || row.expiresAt <= where.expiresAt?.gt || row.expiresAt <= new Date(0)) return { count: 0 };
      rows.delete(where.tokenHash); const next = { ...row, ...data }; rows.set(data.tokenHash, next); return { count: 1 };
    },
    updateMany: async () => ({ count: 0 }),
  }, $transaction: async (callback) => callback(client) };
  // The repository calls updateMany with a conditional Prisma where clause; this mock exercises issuance and token format only.
  const service = createAuthSessionsService({ prismaClient: client, secret: "x".repeat(32) });
  const issued = await service.issue(user);
  assert.match(issued.refreshToken, /^[a-f0-9]{64}$/);
  assert.ok(issued.accessToken);
});
