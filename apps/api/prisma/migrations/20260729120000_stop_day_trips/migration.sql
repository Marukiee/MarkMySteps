-- Day trips: an excursion made from a stop and back the same day. It hangs off
-- its parent stop instead of being a leg of the route, so it never shifts the
-- nights (and therefore the dates) of the stops after it.
ALTER TABLE "stops" ADD COLUMN "parentStopId" UUID;
ALTER TABLE "stops" ADD COLUMN "dayTripDate" DATE;

ALTER TABLE "stops"
  ADD CONSTRAINT "stops_parentStopId_fkey"
  FOREIGN KEY ("parentStopId") REFERENCES "stops"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "stops_parentStopId_idx" ON "stops"("parentStopId");
