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

test("financial schemas require valid refund amounts and explicit review decisions", () => {
  assert.equal(refundRequestSchema.safeParse({ paymentAttemptId: "pay_1", amountMinor: "1200", reason: "Customer was charged twice" }).success, true);
  assert.equal(refundRequestSchema.safeParse({ paymentAttemptId: "pay_1", amountMinor: "-1", reason: "Duplicate payment issue" }).success, false);
  assert.equal(reviewRefundSchema.safeParse({ decision: "APPROVE", reviewNote: "Verified duplicate charge" }).success, true);
  assert.equal(confirmPayoutSchema.safeParse({ providerReference: "settlement-123" }).success, true);
});

test("refresh token rotation invalidates the previous token", async () => {
  const rows = new Map();
  const user = { id: "user_1", role: "CUSTOMER", status: "ACTIVE", emailVerifiedAt: new Date() };
  const client = {
    authSession: {
      create: async ({ data }) => { const row = { id: "session_1", ...data, user }; rows.set(data.tokenHash, row); return row; },
      findUnique: async ({ where }) => rows.get(where.tokenHash) ?? null,
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.tokenHash);
        if (!row || row.id !== where.id || row.revokedAt || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        rows.delete(where.tokenHash);
        rows.set(data.tokenHash, { ...row, ...data });
        return { count: 1 };
      },
    },
    $transaction: async (callback) => callback(client),
  };
  const service = createAuthSessionsService({ prismaClient: client, secret: "x".repeat(32) });
  const issued = await service.issue(user);
  assert.match(issued.refreshToken, /^[a-f0-9]{64}$/);
  assert.equal(rows.has(issued.refreshToken), false);
  const rotated = await service.refresh(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  assert.equal(rows.has(issued.refreshToken), false);
  await assert.rejects(() => service.refresh(issued.refreshToken), { code: "INVALID_REFRESH_TOKEN" });
});
