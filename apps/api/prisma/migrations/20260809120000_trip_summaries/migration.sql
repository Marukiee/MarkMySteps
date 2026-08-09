-- Posters made from a trip, rendered on the device and kept here so they
-- survive a reinstall. The recipe travels with the picture.
CREATE TABLE "trip_summaries" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_summaries_pkey" PRIMARY KEY ("id")
);

-- One image per page: a single poster has one, a series has one per day.
CREATE TABLE "trip_summary_pages" (
    "id" UUID NOT NULL,
    "summaryId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "image" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,

    CONSTRAINT "trip_summary_pages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_summaries_tripId_idx" ON "trip_summaries"("tripId");

CREATE UNIQUE INDEX "trip_summary_pages_summaryId_index_key" ON "trip_summary_pages"("summaryId", "index");

ALTER TABLE "trip_summaries" ADD CONSTRAINT "trip_summaries_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_summaries" ADD CONSTRAINT "trip_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_summary_pages" ADD CONSTRAINT "trip_summary_pages_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "trip_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
