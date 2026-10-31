import test from "node:test";
import assert from "node:assert/strict";
import { createSupportService } from "./support.service.js";

function setup({ ticket, role = "CUSTOMER", customerId = "customer-1" } = {}) {
  const state = { created: null, audit: null, listed: [] };
  const tx = {
    supportTicket: { findUnique: async () => ticket },
    supportTicketMessage: {
      create: async ({ data }) => {
        state.created = data;
        return { id: "message-1", ...data, createdAt: new Date("2026-10-31T12:00:00.000Z"), author: { id: data.authorId, fullName: "Agent", role } };
      },
    },
    operationalAuditEvent: { create: async ({ data }) => { state.audit = data; return data; } },
  };
  const prismaClient = {
    $transaction: async callback => callback(tx),
    supportTicket: { findUnique: async () => ticket },
    supportTicketMessage: { findMany: async ({ where }) => { state.listed.push(where); return []; } },
  };
  return {
    state,
    service: createSupportService({ prismaClient }),
    user: { id: role === "CUSTOMER" ? customerId : "support-1", role },
  };
}

test("ticket owner can create a public reply and the action is audited", async () => {
  const { service, state, user } = setup({ ticket: { id: "ticket-1", customerId: "customer-1", status: "OPEN" } });
  const message = await service.createMessage({ ticketId: "ticket-1", user, input: { visibility: "PUBLIC", body: "Please share an update." } });
  assert.equal(message.visibility, "PUBLIC");
  assert.equal(state.created.authorId, "customer-1");
  assert.equal(state.audit.action, "SUPPORT_TICKET_MESSAGE_CREATED");
  assert.equal(state.audit.metadata.visibility, "PUBLIC");
});

test("customer cannot create an internal note", async () => {
  const { service, user } = setup({ ticket: { id: "ticket-1", customerId: "customer-1", status: "OPEN" } });
  await assert.rejects(
    service.createMessage({ ticketId: "ticket-1", user, input: { visibility: "INTERNAL", body: "Private note" } }),
    error => error.statusCode === 403,
  );
});

test("customer cannot read another customer's ticket messages", async () => {
  const { service, user, state } = setup({ ticket: { id: "ticket-1", customerId: "customer-2", status: "OPEN" } });
  await assert.rejects(service.listMessages({ ticketId: "ticket-1", user }), error => error.statusCode === 404);
  assert.equal(state.listed.length, 0);
});

test("support agents can read internal notes while customers cannot", async () => {
  const ticket = { id: "ticket-1", customerId: "customer-1", status: "OPEN" };
  const customer = setup({ ticket });
  await customer.service.listMessages({ ticketId: "ticket-1", user: { id: "customer-1", role: "CUSTOMER" } });
  assert.deepEqual(customer.state.listed[0], { ticketId: "ticket-1", visibility: "PUBLIC" });

  const support = setup({ ticket, role: "SUPPORT" });
  await support.service.listMessages({ ticketId: "ticket-1", user: { id: "support-1", role: "SUPPORT" } });
  assert.deepEqual(support.state.listed[0], { ticketId: "ticket-1" });
});

test("closed tickets reject new conversation messages", async () => {
  const { service, user } = setup({ ticket: { id: "ticket-1", customerId: "customer-1", status: "CLOSED" } });
  await assert.rejects(
    service.createMessage({ ticketId: "ticket-1", user, input: { visibility: "PUBLIC", body: "One more thing." } }),
    error => error.code === "SUPPORT_TICKET_CLOSED",
  );
});
