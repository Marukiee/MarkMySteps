-- The face of a stop's tile in the timeline rail: a photo the traveller picked
-- from the viewer, rather than whichever one happens to be first that day.
-- Deliberately not a foreign key: deleting the photo should leave the stop
-- alone, and the rail falls back to its own pick when the id resolves to
-- nothing.
ALTER TABLE "stops" ADD COLUMN "coverMediaId" UUID;
