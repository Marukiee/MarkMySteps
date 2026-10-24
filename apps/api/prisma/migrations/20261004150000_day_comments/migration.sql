-- Comments on a day's story as well as on a photo: exactly one of the two.
ALTER TABLE "photo_comments" ALTER COLUMN "mediaId" DROP NOT NULL;
ALTER TABLE "photo_comments" ADD COLUMN "day" DATE;
ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_target_check"
  CHECK (("mediaId" IS NULL) <> ("day" IS NULL));
CREATE INDEX "photo_comments_tripId_day_idx" ON "photo_comments"("tripId", "day");
