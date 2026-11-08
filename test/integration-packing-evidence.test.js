import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createIntegrationPackingEvidenceService } from "../src/modules/integrations/integration-packing-evidence.service.js";

function harness() {
  const rows = [];
  const stored = new Map();
  const booking = { id: "booking-1", publicReference: "LH-PCL-TEST01" };
  const client = { id: "client-1", code: "MARKETIQ" };
  const storage = {
    provider: "CLOUDINARY",
    bucket: "test-bucket",
    async upload({ objectPath, buffer }) { stored.set(objectPath, Buffer.from(buffer)); return objectPath; },
    async delete({ objectPath }) { stored.delete(objectPath); },
    async download({ objectPath }) { return Buffer.from(stored.get(objectPath)); },
  };
  const prismaClient = {
    integrationExternalReference: { findFirst: async () => ({ internalResourceId: booking.id }) },
    parcelBooking: { findFirst: async () => booking },
    integrationPackingEvidence: {
      findMany: async ({ where }) => rows.filter(row => row.clientId === where.clientId && row.parcelBookingId === where.parcelBookingId)
        .sort((a,b) => a.slot.localeCompare(b.slot) || b.version - a.version),
      findFirst: async ({ where }) => rows.find(row => row.id === where.id && row.clientId === where.clientId && row.parcelBookingId === where.parcelBookingId) ?? null,
    },
    $transaction: async work => work({
      $queryRaw: async () => [],
      integrationPackingEvidence: {
        findUnique: async ({ where }) => rows.find(row => row.clientId === where.clientId_idempotencyKey.clientId && row.idempotencyKey === where.clientId_idempotencyKey.idempotencyKey) ?? null,
        aggregate: async ({ where }) => ({ _max: { version: Math.max(0, ...rows.filter(row => row.parcelBookingId === where.parcelBookingId && row.slot === where.slot).map(row => row.version)) || null } }),
        create: async ({ data }) => {
          const row = { id: `evidence-${rows.length + 1}`, ...data };
          rows.push(row);
          return row;
        },
        findMany: async ({ where, orderBy }) => rows.filter(row => row.clientId === where.clientId && row.parcelBookingId === where.parcelBookingId)
          .sort((a,b) => a.slot.localeCompare(b.slot) || b.version - a.version),
        findFirst: async ({ where }) => rows.find(row => row.id === where.id && row.clientId === where.clientId && row.parcelBookingId === where.parcelBookingId) ?? null,
      },
      bookingEvent: { create: async () => ({ id: "booking-event-1" }) },
    }),
  };
  return { service: createIntegrationPackingEvidenceService({ prismaClient, storage }), rows, stored, client };
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);
const metadata = (idempotencyKey, originalName = "packing.jpg") => ({
  slot: "CONTENTS_OVERVIEW", actorReference: "seller-1", originalName,
  mimeType: "image/jpeg", idempotencyKey,
});

test("packing evidence is immutable, versioned per slot and idempotent", async () => {
  const { service, rows, stored, client } = harness();
  const first = await service.upload({
    client, externalFulfillmentReference: "mqi-order-1", metadata: metadata("upload-key-0001"), buffer: jpeg,
  });
  assert.equal(first.version, 1);
  assert.equal(first.replay, false);

  const replay = await service.upload({
    client, externalFulfillmentReference: "mqi-order-1", metadata: metadata("upload-key-0001"), buffer: jpeg,
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.replay, true);
  assert.equal(rows.length, 1);
  assert.equal(stored.size, 1);

  const replacement = await service.upload({
    client, externalFulfillmentReference: "mqi-order-1", metadata: metadata("upload-key-0002", "replacement.jpg"), buffer: jpeg,
  });
  assert.equal(replacement.version, 2);
  assert.equal(rows.length, 2);
  assert.equal(stored.size, 2);
});

test("buyer-facing evidence list exposes only the latest version for each slot", async () => {
  const { service, client } = harness();
  await service.upload({ client, externalFulfillmentReference: "mqi-order-1", metadata: metadata("upload-key-0001"), buffer: jpeg });
  await service.upload({ client, externalFulfillmentReference: "mqi-order-1", metadata: metadata("upload-key-0002"), buffer: jpeg });
  const result = await service.list({ client, externalFulfillmentReference: "mqi-order-1" });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].version, 2);
});

test("download verifies stored bytes against the immutable checksum", async () => {
  const { service, client } = harness();
  const uploaded = await service.upload({
    client, externalFulfillmentReference: "mqi-order-1", metadata: metadata("upload-key-0001"), buffer: jpeg,
  });
  const file = await service.download({
    client, externalFulfillmentReference: "mqi-order-1", evidenceId: uploaded.id,
  });
  assert.deepEqual(file.buffer, jpeg);
  assert.equal(createHash("sha256").update(file.buffer).digest("hex"), uploaded.sha256);
});
