-- Guest role (view-only) + per-member tracking permission.
ALTER TYPE "TripRole" ADD VALUE IF NOT EXISTS 'GUEST';
ALTER TABLE "trip_members" ADD COLUMN "canTrack" BOOLEAN NOT NULL DEFAULT true;
