-- CreateEnum
CREATE TYPE "TripRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "immich_connections" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "immich_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_members" (
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TripRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_members_pkey" PRIMARY KEY ("tripId","userId")
);

-- CreateTable
CREATE TABLE "media_refs" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "immichAssetId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    -- Auto-derived from latitude/longitude; NULL when either is NULL.
    "geom" geometry(Point, 4326) GENERATED ALWAYS AS (
        CASE WHEN "longitude" IS NOT NULL AND "latitude" IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
             ELSE NULL END
    ) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "immich_connections_userId_key" ON "immich_connections"("userId");

-- CreateIndex
CREATE INDEX "media_refs_tripId_takenAt_idx" ON "media_refs"("tripId", "takenAt");

-- CreateIndex
CREATE INDEX "media_refs_geom_idx" ON "media_refs" USING GIST ("geom");

-- CreateIndex
CREATE UNIQUE INDEX "media_refs_tripId_userId_immichAssetId_key" ON "media_refs"("tripId", "userId", "immichAssetId");

-- AddForeignKey
ALTER TABLE "immich_connections" ADD CONSTRAINT "immich_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_refs" ADD CONSTRAINT "media_refs_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_refs" ADD CONSTRAINT "media_refs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

