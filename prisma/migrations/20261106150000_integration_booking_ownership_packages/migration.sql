-- GIL-04B: distinguish user-owned bookings from integration-owned shipments.
-- Existing rows all remain user-owned; no synthetic users or backfill are required.
ALTER TABLE "parcel_bookings"
  ALTER COLUMN "sender_id" DROP NOT NULL,
  ADD COLUMN "integration_client_id" TEXT;

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_integration_client_id_fkey"
  FOREIGN KEY ("integration_client_id")
  REFERENCES "integration_clients"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- A parcel booking must have exactly one owner: a Logistic Hub user OR an integration client.
ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_exactly_one_owner_check"
  CHECK (
    ("sender_id" IS NOT NULL AND "integration_client_id" IS NULL)
    OR
    ("sender_id" IS NULL AND "integration_client_id" IS NOT NULL)
  );

CREATE INDEX "parcel_bookings_integration_client_id_created_at_idx"
  ON "parcel_bookings"("integration_client_id", "created_at");

CREATE TABLE "parcel_booking_packages" (
  "id" TEXT NOT NULL,
  "parcel_booking_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "external_package_ref" TEXT,
  "package_category" TEXT NOT NULL,
  "description" TEXT,
  "weight_grams" INTEGER,
  "length_mm" INTEGER,
  "width_mm" INTEGER,
  "height_mm" INTEGER,
  "declared_value_minor" BIGINT,
  "assessment_status" "PackageAssessmentStatus" NOT NULL DEFAULT 'DECLARED',
  "assessment_source" TEXT NOT NULL DEFAULT 'INTEGRATOR_DECLARED',
  "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assessment_snapshot" JSONB,
  "rate_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parcel_booking_packages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parcel_booking_packages_parcel_booking_id_fkey"
    FOREIGN KEY ("parcel_booking_id")
    REFERENCES "parcel_bookings"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "parcel_booking_packages_parcel_booking_id_sequence_key"
  ON "parcel_booking_packages"("parcel_booking_id", "sequence");

CREATE UNIQUE INDEX "parcel_booking_packages_parcel_booking_id_external_package_ref_key"
  ON "parcel_booking_packages"("parcel_booking_id", "external_package_ref");

CREATE INDEX "parcel_booking_packages_parcel_booking_id_assessment_status_idx"
  ON "parcel_booking_packages"("parcel_booking_id", "assessment_status");
