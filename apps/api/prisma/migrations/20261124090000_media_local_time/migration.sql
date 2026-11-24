-- The wall-clock time where a photo was taken, so it lands on the day it was taken there.
-- Nullable: existing rows keep working on takenAt and get it on their next sync.

-- AlterTable
ALTER TABLE "media_refs" ADD COLUMN "takenAtLocal" TIMESTAMP(3);
