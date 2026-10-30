ALTER TYPE "DeliveryLegStatus" ADD VALUE 'READY_FOR_ASSIGNMENT';

ALTER TABLE "delivery_legs"
  ADD COLUMN "originHubPointId" TEXT,
  ADD COLUMN "destinationHubPointId" TEXT,
  ADD COLUMN "originLatitude" DECIMAL(10,7),
  ADD COLUMN "originLongitude" DECIMAL(10,7),
  ADD COLUMN "destinationLatitude" DECIMAL(10,7),
  ADD COLUMN "destinationLongitude" DECIMAL(10,7);

CREATE INDEX "delivery_legs_originHubPointId_idx"
  ON "delivery_legs"("originHubPointId");

CREATE INDEX "delivery_legs_destinationHubPointId_idx"
  ON "delivery_legs"("destinationHubPointId");

ALTER TABLE "delivery_legs"
  ADD CONSTRAINT "delivery_legs_originHubPointId_fkey"
    FOREIGN KEY ("originHubPointId") REFERENCES "hub_points"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_legs_destinationHubPointId_fkey"
    FOREIGN KEY ("destinationHubPointId") REFERENCES "hub_points"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "delivery_legs_origin_coordinates_pair"
    CHECK (("originLatitude" IS NULL) = ("originLongitude" IS NULL)),
  ADD CONSTRAINT "delivery_legs_destination_coordinates_pair"
    CHECK (("destinationLatitude" IS NULL) = ("destinationLongitude" IS NULL)),
  ADD CONSTRAINT "delivery_legs_origin_latitude_range"
    CHECK ("originLatitude" IS NULL OR "originLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "delivery_legs_origin_longitude_range"
    CHECK ("originLongitude" IS NULL OR "originLongitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "delivery_legs_destination_latitude_range"
    CHECK ("destinationLatitude" IS NULL OR "destinationLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "delivery_legs_destination_longitude_range"
    CHECK ("destinationLongitude" IS NULL OR "destinationLongitude" BETWEEN -180 AND 180);
