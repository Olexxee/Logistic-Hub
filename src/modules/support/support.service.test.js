import test from "node:test";
import assert from "node:assert/strict";
import { createSupportService } from "./support.service.js";

function setup({ ticket, assignee = { id: "support-2", role: "SUPPORT" }, ownedBooking = true } = {}) {
  const writes = { ticket: null, audit: null, audits: [], operationalCase: null };
  const tx = {
    supportTicket: {
      findUnique: async () => ticket,
      update: async ({ data }) => {
        writes.ticket = data;
        Object.assign(ticket ?? {}, data);
        return { ...ticket, ...data };
      },
    },
    user: { findUnique: async () => assignee },
    operationalAuditEvent: {
      create: async ({ data }) => { writes.audit = data; writes.audits.push(data); return data; },
    },
    operationalCase: {
      findUnique: async () => writes.operationalCase,
      create: async ({ data }) => { writes.operationalCase = { id: "case-1", publicReference: "CASE-TEST", ...data }; return writes.operationalCase; },
    },
    parcelBooking: { findFirst: async () => ({ id: "booking-1", publicReference: "LH-PCL-TEST" }) },
  };
  const prismaClient = {
    $transaction: async callback => callback(tx),
    supportTicket: { create: async ({ data }) => data },
    parcelBooking: { findFirst: async () => ownedBooking ? ({ id: "booking-1" }) : null },
    rideBooking: { findFirst: async () => ({ id: "ride-1" }) },
  };
  const service = createSupportService({ prismaClient, clock: () => new Date("2026-10-31T12:00:00.000Z") });
  return { service, writes };
}

test("support ticket cannot be assigned to a non-support account", async () => {
  const { service } = setup({
    ticket: { id: "ticket-1", status: "OPEN", priority: "NORMAL", assignedToUserId: null, resolution: null },
    assignee: { id: "customer-2", role: "CUSTOMER" },
  });
  await assert.rejects(
    service.update({ id: "ticket-1", user: { id: "admin-1", role: "ADMIN" }, input: { status: "IN_PROGRESS", assignedToUserId: "customer-2" } }),
    error => error.code === "VALIDATION_ERROR",
  );
});

test("support ticket cannot be resolved without a resolution summary", async () => {
  const { service, writes } = setup({
    ticket: { id: "ticket-1", status: "IN_PROGRESS", priority: "NORMAL", assignedToUserId: null, resolution: null },
  });
  await assert.rejects(
    service.update({ id: "ticket-1", user: { id: "support-1", role: "SUPPORT" }, input: { status: "RESOLVED" } }),
    error => error.code === "VALIDATION_ERROR",
  );
  assert.equal(writes.ticket, null);
});

test("closed support tickets reject further lifecycle updates", async () => {
  const { service } = setup({
    ticket: { id: "ticket-1", status: "CLOSED", priority: "NORMAL", assignedToUserId: null, resolution: "Resolved with customer." },
  });
  await assert.rejects(
    service.update({ id: "ticket-1", user: { id: "admin-1", role: "ADMIN" }, input: { status: "IN_PROGRESS" } }),
    error => error.code === "SUPPORT_TICKET_CLOSED",
  );
});

test("valid support ticket resolution is audited", async () => {
  const { service, writes } = setup({
    ticket: { id: "ticket-1", status: "IN_PROGRESS", priority: "NORMAL", assignedToUserId: null, resolution: null },
  });
  const result = await service.update({
    id: "ticket-1",
    user: { id: "support-1", role: "SUPPORT" },
    input: { status: "RESOLVED", resolution: "Carrier confirmed delivery and customer acknowledged receipt." },
  });
  assert.equal(result.status, "RESOLVED");
  assert.equal(writes.ticket.resolvedAt.toISOString(), "2026-10-31T12:00:00.000Z");
  assert.equal(writes.audit.entityType, "SUPPORT_TICKET");
  assert.equal(writes.audit.action, "SUPPORT_TICKET_UPDATED");
});

test("support requests cannot reference another customer's booking", async () => {
  const { service } = setup({ ownedBooking: false });
  await assert.rejects(
    service.create({
      user: { id: "customer-1", role: "CUSTOMER" },
      input: { bookingType: "PARCEL", bookingId: "someone-elses-booking", category: "DELIVERY", subject: "Delivery issue", description: "The delivery has not arrived yet." },
    }),
    error => error.statusCode === 404,
  );
});


test("support can escalate a parcel ticket into one linked operational case with audit history", async () => {
  const ticket = {
    id: "ticket-1", publicReference: "SUP-TEST", customerId: "customer-1",
    bookingType: "PARCEL", bookingId: "booking-1", parcelBookingId: null,
    operationalCaseId: null, subject: "Parcel has not arrived",
    description: "The parcel is overdue and the recipient has not received it.",
  };
  const { service, writes } = setup({ ticket });
  const result = await service.escalate({
    id: "ticket-1",
    user: { id: "support-1", role: "SUPPORT" },
    input: { caseType: "FAILED_DELIVERY", priority: "HIGH" },
  });
  assert.equal(result.replay, false);
  assert.equal(result.operationalCase.type, "FAILED_DELIVERY");
  assert.equal(result.operationalCase.parcelBookingId, "booking-1");
  assert.equal(writes.ticket.operationalCaseId, "case-1");
  assert.equal(writes.audits.length, 2);
  assert.equal(writes.audits[0].action, "OPERATIONAL_CASE_CREATED_FROM_SUPPORT_TICKET");
  assert.equal(writes.audits[1].action, "SUPPORT_TICKET_ESCALATED_TO_OPERATIONAL_CASE");
});

test("support escalation returns the already linked case instead of creating a duplicate", async () => {
  const ticket = {
    id: "ticket-1", publicReference: "SUP-TEST", customerId: "customer-1",
    bookingType: "PARCEL", bookingId: "booking-1", operationalCaseId: "case-1",
  };
  const { service, writes } = setup({ ticket });
  writes.operationalCase = { id: "case-1", publicReference: "CASE-TEST", type: "MISSING_PARCEL" };
  const result = await service.escalate({
    id: "ticket-1",
    user: { id: "admin-1", role: "ADMIN" },
    input: { caseType: "FAILED_DELIVERY" },
  });
  assert.equal(result.replay, true);
  assert.equal(result.operationalCase.id, "case-1");
  assert.equal(writes.audits.length, 0);
});

test("ride support tickets cannot be escalated into parcel operational cases", async () => {
  const ticket = {
    id: "ticket-1", customerId: "customer-1", bookingType: "RIDE",
    bookingId: "ride-1", operationalCaseId: null,
  };
  const { service } = setup({ ticket });
  await assert.rejects(
    service.escalate({ id: "ticket-1", user: { id: "support-1", role: "SUPPORT" }, input: { caseType: "FAILED_DELIVERY" } }),
    error => error.code === "PARCEL_BOOKING_REQUIRED",
  );
});
