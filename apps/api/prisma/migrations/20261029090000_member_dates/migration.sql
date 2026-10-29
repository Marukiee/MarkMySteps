-- The part of a trip a companion was there for, when it was not all of it.

-- AlterTable
ALTER TABLE "trip_members" ADD COLUMN "fromDate" DATE,
ADD COLUMN "toDate" DATE;
