-- Username (nullable first: existing rows get a backfilled handle derived
-- from their email prefix, then the column becomes NOT NULL + unique).
ALTER TABLE "users" ADD COLUMN "username" TEXT;

WITH ranked AS (
    SELECT id,
           COALESCE(NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9._-]', '', 'g')), ''), 'user') AS base,
           row_number() OVER (
               PARTITION BY COALESCE(NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9._-]', '', 'g')), ''), 'user')
               ORDER BY "createdAt"
           ) AS rn
    FROM "users"
)
UPDATE "users" u
SET "username" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || r.rn::text END
FROM ranked r
WHERE u.id = r.id;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_slug_key" ON "share_links"("slug");

-- CreateIndex
CREATE INDEX "share_links_tripId_idx" ON "share_links"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
