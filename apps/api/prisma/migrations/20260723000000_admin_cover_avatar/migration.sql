-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- AlterTable

-- AlterTable

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "coverMediaId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar" BYTEA,
ADD COLUMN     "avatarMime" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';


-- The first account on the server becomes admin.
UPDATE "users" SET "role" = 'ADMIN'
WHERE id = (SELECT id FROM "users" ORDER BY "createdAt" ASC LIMIT 1);
