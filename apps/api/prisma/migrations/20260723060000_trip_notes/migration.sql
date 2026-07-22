-- AlterTable

-- AlterTable

-- CreateTable
CREATE TABLE "trip_notes" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_notes_tripId_day_idx" ON "trip_notes"("tripId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "trip_notes_tripId_authorId_day_key" ON "trip_notes"("tripId", "authorId", "day");

-- AddForeignKey
ALTER TABLE "trip_notes" ADD CONSTRAINT "trip_notes_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_notes" ADD CONSTRAINT "trip_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

