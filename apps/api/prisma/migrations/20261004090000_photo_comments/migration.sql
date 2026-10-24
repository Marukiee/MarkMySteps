-- Reactions on a trip's photos: from visitors on the share page (a typed
-- name, no account) and from the people on the trip answering them.
CREATE TABLE "photo_comments" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "userId" UUID,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "photo_comments_tripId_idx" ON "photo_comments"("tripId");

CREATE INDEX "photo_comments_mediaId_createdAt_idx" ON "photo_comments"("mediaId", "createdAt");

ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
