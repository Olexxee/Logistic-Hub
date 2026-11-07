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
CREATE INDEX "integration_shipment_events_clientId_parcelBookingId_sequence_idx"
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
