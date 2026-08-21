-- Pixel dimensions of a photo, taken from Immich's EXIF and already corrected
-- for orientation. The gallery lays photos out at their real shape, which it
-- cannot do from the bytes alone without first downloading every one of them.
-- Existing rows stay NULL until the next sync fills them in.
ALTER TABLE "media_refs"
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER;
