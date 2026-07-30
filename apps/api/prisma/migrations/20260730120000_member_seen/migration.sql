-- Memberships that already exist were never announced and never will be:
-- default true means only the ones added from here on can be new to someone.
ALTER TABLE "trip_members" ADD COLUMN "seen" BOOLEAN NOT NULL DEFAULT true;
