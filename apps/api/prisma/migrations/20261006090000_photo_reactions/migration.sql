-- Emoji reactions on photos: one per person per photo.
CREATE TABLE "photo_reactions" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reactorKey" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photo_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "photo_reactions_mediaId_reactorKey_key" ON "photo_reactions"("mediaId", "reactorKey");
CREATE INDEX "photo_reactions_tripId_idx" ON "photo_reactions"("tripId");

ALTER TABLE "photo_reactions" ADD CONSTRAINT "photo_reactions_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "photo_reactions" ADD CONSTRAINT "photo_reactions_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
