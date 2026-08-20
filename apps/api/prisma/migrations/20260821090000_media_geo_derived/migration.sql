-- A photo without GPS can still be placed: the trip's own tracked route knows
-- where its owner was at that minute. Such a position is marked as derived so
-- real EXIF always wins it back, and the push to Immich is recorded so the
-- same asset is not written twice.
ALTER TABLE "media_refs"
  ADD COLUMN "geoDerived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "geoPushedAt" TIMESTAMP(3);

-- The matcher looks for exactly these: the ones still missing a position.
CREATE INDEX "media_refs_tripId_latitude_idx" ON "media_refs" ("tripId", "latitude");
