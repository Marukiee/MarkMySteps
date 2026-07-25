-- Manual globe-marker position for a trip (null = auto). Lets a loop/interrail
-- trip place its single dot + name badge where it best fits the route.
ALTER TABLE "trips" ADD COLUMN "markerLng" DOUBLE PRECISION;
ALTER TABLE "trips" ADD COLUMN "markerLat" DOUBLE PRECISION;
