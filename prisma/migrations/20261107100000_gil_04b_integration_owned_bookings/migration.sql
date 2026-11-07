-- GIL-04B: integration-owned booking identity and normalized consignment packages.
-- Existing customer bookings retain their sender ownership and legacy parcel fields.

ALTER TABLE "parcel_bookings"
  ALTER COLUMN "senderId" DROP NOT NULL,
  ALTER COLUMN "parcelCategory" DROP NOT NULL,
  ALTER COLUMN "parcelSize" DROP NOT NULL,
  ADD COLUMN "integrationClientId" TEXT;

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_exactly_one_owner"
  CHECK ((("senderId" IS NOT NULL)::int + ("integrationClientId" IS NOT NULL)::int) = 1);

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_integration_booking_has_no_legacy_parcel_flattening"
  CHECK ("integrationClientId" IS NULL OR ("parcelCategory" IS NULL AND "parcelSize" IS NULL));

ALTER TABLE "parcel_bookings"
  ADD CONSTRAINT "parcel_bookings_integration_client_fk"
  FOREIGN KEY ("integrationClientId") REFERENCES "integration_clients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "parcel_bookings_integrationClientId_createdAt_idx"
  ON "parcel_bookings" ("integrationClientId", "createdAt");

CREATE TABLE "parcel_booking_packages" (
  "id" TEXT NOT NULL,
  "parcelBookingId" TEXT NOT NULL,
  "externalPackageRef" TEXT,
  "packageCategory" TEXT NOT NULL,
  "description" TEXT,
  "weightGrams" INTEGER,
  "lengthMm" INTEGER,
  "widthMm" INTEGER,
  "heightMm" INTEGER,
  "declaredValueMinor" BIGINT,
  "assessmentStatus" "PackageAssessmentStatus" NOT NULL DEFAULT 'DECLARED',
  "assessmentSource" TEXT NOT NULL DEFAULT 'INTEGRATOR_DECLARED',
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "parcel_booking_packages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parcel_booking_packages_positive_weight"
    CHECK ("weightGrams" IS NULL OR "weightGrams" > 0),
  CONSTRAINT "parcel_booking_packages_positive_dimensions"
    CHECK (("lengthMm" IS NULL OR "lengthMm" > 0) AND ("widthMm" IS NULL OR "widthMm" > 0) AND ("heightMm" IS NULL OR "heightMm" > 0)),
  CONSTRAINT "parcel_booking_packages_nonnegative_declared_value"
    CHECK ("declaredValueMinor" IS NULL OR "declaredValueMinor" >= 0)
);

CREATE UNIQUE INDEX "parcel_booking_packages_booking_external_ref_key"
  ON "parcel_booking_packages" ("parcelBookingId", "externalPackageRef");
CREATE INDEX "parcel_booking_packages_booking_created_idx"
  ON "parcel_booking_packages" ("parcelBookingId", "createdAt");
CREATE INDEX "parcel_booking_packages_booking_assessment_idx"
  ON "parcel_booking_packages" ("parcelBookingId", "assessmentStatus");

ALTER TABLE "parcel_booking_packages"
  ADD CONSTRAINT "parcel_booking_packages_booking_fk"
  FOREIGN KEY ("parcelBookingId") REFERENCES "parcel_bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
