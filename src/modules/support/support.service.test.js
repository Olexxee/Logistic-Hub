import test from "node:test";
import assert from "node:assert/strict";
import { createSupportService } from "./support.service.js";

function setup({ ticket, assignee = { id: "support-2", role: "SUPPORT" }, ownedBooking = true } = {}) {
  const writes = { ticket: null, audit: null };
  const tx = {
    supportTicket: {
      findUnique: async () => ticket,
      update: async ({ data }) => {
        writes.ticket = data;
        return { ...ticket, ...data };
      },
    },
    user: { findUnique: async () => assignee },
    operationalAuditEvent: {
      create: async ({ data }) => { writes.audit = data; return data; },
    },
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
