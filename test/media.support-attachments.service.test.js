import test from "node:test";
import assert from "node:assert/strict";
import { createMediaService } from "../src/modules/media/media.service.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function setup({ ticket = { id: "ticket-1", customerId: "customer-1", status: "OPEN" } } = {}) {
  const state = { uploaded: [], deleted: [], media: null, attachment: null, audit: [] };
  const tx = {
    mediaAsset: {
      create: async ({ data }) => {
        state.media = { id: "media-1", ...data, createdAt: new Date("2026-10-31T12:00:00Z") };
        return state.media;
      },
    },
    supportTicketAttachment: {
      create: async ({ data }) => {
        state.attachment = { id: "attachment-1", ...data };
        return state.attachment;
      },
    },
    operationalAuditEvent: { create: async ({ data }) => { state.audit.push(data); return data; } },
  };
  const prismaClient = {
    supportTicket: { findUnique: async () => ticket },
    $transaction: async callback => callback(tx),
  };
  const storage = {
    bucket: "logistic-hub-evidence",
    upload: async input => state.uploaded.push(input),
    delete: async input => state.deleted.push(input),
  };
  return { state, service: createMediaService({ prismaClient, storage }) };
}

test("ticket owner can upload valid evidence and the asset metadata is audited", async () => {
  const { service, state } = setup();
  const result = await service.uploadTicketAttachment({
    ticketId: "ticket-1",
    user: { id: "customer-1", fullName: "Customer", role: "CUSTOMER" },
    buffer: png,
    mimeType: "image/png",
    originalName: "../../delivery-proof.png",
  });
  assert.equal(result.attachmentId, "attachment-1");
  assert.equal(result.originalName, "delivery-proof.png");
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.sizeBytes, String(png.length));
  assert.equal(state.uploaded.length, 1);
  assert.equal(state.media.storageProvider, "FIREBASE");
  assert.equal(state.audit[0].action, "SUPPORT_TICKET_EVIDENCE_UPLOADED");
  assert.match(state.media.objectPath, /^support-tickets\/ticket-1\/[0-9a-f-]+\.png$/);
});

test("a customer cannot upload evidence to another customer's ticket", async () => {
  const { service, state } = setup({ ticket: { id: "ticket-1", customerId: "customer-2", status: "OPEN" } });
  await assert.rejects(
    service.uploadTicketAttachment({
      ticketId: "ticket-1",
      user: { id: "customer-1", role: "CUSTOMER" },
      buffer: png,
      mimeType: "image/png",
      originalName: "proof.png",
    }),
    error => error.statusCode === 404,
  );
  assert.equal(state.uploaded.length, 0);
});

test("file extension and declared MIME type cannot bypass content signature validation", async () => {
  const { service, state } = setup();
  await assert.rejects(
    service.uploadTicketAttachment({
      ticketId: "ticket-1",
      user: { id: "customer-1", role: "CUSTOMER" },
      buffer: Buffer.from("not a png"),
      mimeType: "image/png",
      originalName: "proof.png",
    }),
    error => error.statusCode === 400,
  );
  assert.equal(state.uploaded.length, 0);
});

test("closed support tickets reject new evidence", async () => {
  const { service, state } = setup({ ticket: { id: "ticket-1", customerId: "customer-1", status: "CLOSED" } });
  await assert.rejects(
    service.uploadTicketAttachment({
      ticketId: "ticket-1",
      user: { id: "customer-1", role: "CUSTOMER" },
      buffer: png,
      mimeType: "image/png",
      originalName: "proof.png",
    }),
    error => error.statusCode === 400,
  );
  assert.equal(state.uploaded.length, 0);
});
