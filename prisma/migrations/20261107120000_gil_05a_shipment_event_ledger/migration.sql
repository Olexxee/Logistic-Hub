ALTER TABLE "parcel_bookings"
  ADD COLUMN "integrationEventSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "integration_shipment_events" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "sourceBookingEventId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_shipment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_shipment_events_sourceBookingEventId_key"
  ON "integration_shipment_events"("sourceBookingEventId");
CREATE UNIQUE INDEX "integration_shipment_events_parcelBookingId_sequence_key"
  ON "integration_shipment_events"("parcelBookingId", "sequence");
CREATE INDEX "integration_shipment_events_client_shipment_seq_idx"
  ON "integration_shipment_events"("clientId", "parcelBookingId", "sequence");
CREATE INDEX "integration_shipment_events_clientId_createdAt_idx"
  ON "integration_shipment_events"("clientId", "createdAt");

ALTER TABLE "integration_shipment_events"
  ADD CONSTRAINT "integration_shipment_events_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "integration_clients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_shipment_events"
  ADD CONSTRAINT "integration_shipment_events_parcelBookingId_fkey"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve the supported tracking history for integration shipments created before
-- this ledger was deployed. Only explicitly mapped source events are projected.
WITH mapped_events AS (
  SELECT
    gen_random_uuid()::text AS event_id,
    b."integrationClientId" AS client_id,
    b."id" AS booking_id,
    be."id" AS source_event_id,
    ROW_NUMBER() OVER (
      PARTITION BY b."id"
      ORDER BY be."createdAt" ASC, be."id" ASC
    )::INTEGER AS event_sequence,
    CASE be."eventType"
      WHEN 'INTEGRATION_SHIPMENT_CREATED' THEN 'shipment.created'
      WHEN 'INTEGRATION_PARTNER_ASSIGNMENT_CREATED' THEN 'shipment.partner_assigned'
      WHEN 'INTEGRATION_PARTNER_LEG_STARTED' THEN 'shipment.in_transit'
      WHEN 'HUB_PICKUP_CUSTODY_CONFIRMED' THEN 'shipment.custody_handover_confirmed'
      WHEN 'HUB_DESTINATION_CUSTODY_CONFIRMED' THEN 'shipment.delivery_leg_completed'
      WHEN 'PARTNER_HUB_CUSTODY_CONFIRMED' THEN 'shipment.delivery_leg_completed'
    END AS external_event_type,
    be."createdAt" AS occurred_at,
    b."publicReference" AS shipment_reference,
    COALESCE(be."toStatus", b."status"::text) AS shipment_status
  FROM "booking_events" be
  INNER JOIN "parcel_bookings" b ON b."id" = be."parcelBookingId"
  WHERE b."integrationClientId" IS NOT NULL
    AND b."senderId" IS NULL
    AND be."eventType" IN (
      'INTEGRATION_SHIPMENT_CREATED',
      'INTEGRATION_PARTNER_ASSIGNMENT_CREATED',
      'INTEGRATION_PARTNER_LEG_STARTED',
      'HUB_PICKUP_CUSTODY_CONFIRMED',
      'HUB_DESTINATION_CUSTODY_CONFIRMED',
      'PARTNER_HUB_CUSTODY_CONFIRMED'
    )
)
INSERT INTO "integration_shipment_events" (
  "id", "clientId", "parcelBookingId", "sourceBookingEventId",
  "sequence", "eventType", "schemaVersion", "occurredAt", "payload"
)
SELECT
  event_id,
  client_id,
  booking_id,
  source_event_id,
  event_sequence,
  external_event_type,
  1,
  occurred_at,
  jsonb_build_object('shipmentReference', shipment_reference, 'status', shipment_status)
FROM mapped_events;

UPDATE "parcel_bookings" b
SET "integrationEventSequence" = COALESCE((
  SELECT MAX(e."sequence")
  FROM "integration_shipment_events" e
  WHERE e."parcelBookingId" = b."id"
), 0)
WHERE b."integrationClientId" IS NOT NULL
  AND b."senderId" IS NULL;
