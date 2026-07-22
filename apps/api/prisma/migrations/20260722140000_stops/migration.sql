-- AlterTable

-- AlterTable

-- CreateTable
CREATE TABLE "stops" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "nights" INTEGER NOT NULL DEFAULT 1,
    "orderIndex" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stops_tripId_idx" ON "stops"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "stops_tripId_orderIndex_key" ON "stops"("tripId", "orderIndex");

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

