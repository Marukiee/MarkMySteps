-- A leg you would rather not see drawn at all: the stop stays in the route,
-- the line to it does not.
ALTER TABLE "stops" ADD COLUMN "hideLeg" BOOLEAN NOT NULL DEFAULT false;
