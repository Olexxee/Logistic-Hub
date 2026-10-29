-- The preceding security_operations migration creates the canonical
-- refund_requests and support_tickets tables. Extend those tables with booking
-- links instead of creating competing table definitions.

ALTER TABLE "refund_requests"
  ADD COLUMN "parcelBookingId" TEXT,
  ADD COLUMN "rideBookingId" TEXT;

CREATE INDEX "refund_requests_parcelBookingId_status_idx"
  ON "refund_requests"("parcelBookingId", "status");
CREATE INDEX "refund_requests_rideBookingId_status_idx"
  ON "refund_requests"("rideBookingId", "status");

ALTER TABLE "refund_requests"
  ADD CONSTRAINT "refund_requests_parcelBookingId_fkey"
    FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "refund_requests_rideBookingId_fkey"
    FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
  ADD COLUMN "parcelBookingId" TEXT,
  ADD COLUMN "rideBookingId" TEXT;

CREATE INDEX "support_tickets_parcelBookingId_status_idx"
  ON "support_tickets"("parcelBookingId", "status");
CREATE INDEX "support_tickets_rideBookingId_status_idx"
  ON "support_tickets"("rideBookingId", "status");

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_parcelBookingId_fkey"
    FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "support_tickets_rideBookingId_fkey"
    FOREIGN KEY ("rideBookingId") REFERENCES "ride_bookings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
