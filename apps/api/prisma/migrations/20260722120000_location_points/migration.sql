-- CreateEnum
CREATE TYPE "PointSource" AS ENUM ('TRACKED', 'MANUAL', 'IMPORTED');

-- AlterTable

-- CreateTable
CREATE TABLE "location_points" (
    "id" UUID NOT NULL,
    "clientId" TEXT,
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "source" "PointSource" NOT NULL DEFAULT 'TRACKED',
    -- Auto-derived from latitude/longitude.
    "geom" geometry(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
    ) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_points_tripId_recordedAt_idx" ON "location_points"("tripId", "recordedAt");

-- CreateIndex
CREATE INDEX "location_points_geom_idx" ON "location_points" USING GIST ("geom");

-- CreateIndex
CREATE UNIQUE INDEX "location_points_tripId_userId_clientId_key" ON "location_points"("tripId", "userId", "clientId");

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

