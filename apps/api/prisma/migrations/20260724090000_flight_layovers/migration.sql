-- Layover airports for a flight leg (ordered IATA codes).
ALTER TABLE "stops" ADD COLUMN "viaAirports" TEXT[] NOT NULL DEFAULT '{}';
